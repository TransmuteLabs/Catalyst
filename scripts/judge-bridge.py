#!/usr/bin/env python3
# Мост к площадке судьи: HTTP-площадка провайдеров (CLIProxyM, 127.0.0.1:8317)
# живёт ТОЛЬКО на маке, а живую приёмку судьи надо гнать на usbox (Linux),
# где прямого пути к площадке нет. Этот инструмент поднимает мост
# usbox -> мак, держит его до сигнала/таймера и, завершаясь, убирает за собой
# всё, что поднял (свои ssh-каналы, свой диспетчер, свой каталог на usbox).
#
# Схема (направление инициации развёрнуто -- см. CONSTRAINT про -R ниже):
#   [usbox] клиент -> 127.0.0.1:<client-port>  [диспетчер]
#                          | спаривание: одно клиентское соединение = один канал
#   [usbox] /usr/bin/ncat -> 127.0.0.1:<service-port>   (рабочий канал N)
#   [мак]   ssh-сессия канала <-> stdio ncat (две нити прокачки)
#   [мак]   ленивое подключение к площадке при первом байте запроса
# Мак держит пул ssh-каналов (--pool, умолчание 4); диспетчер на usbox выдаёт
# по каналу на каждое клиентское соединение, израсходованный канал мак
# заменяет, поддерживая размер пула, пока мост жив.
#
# CONSTRAINT: ssh -R (обратный форвардинг) НЕ используется и не пробуется:
# sshd usbox запрещает remote forwarding (замер 16.09: отказ «remote port
# forwarding failed» на двух разных свободных портах, ControlMaster=no
# повторил отказ), а править sshd запрещено. Поэтому все соединения
# инициирует мак: ssh-сессии идут ОТ мака К usbox.
#
# CONSTRAINT: положительный контроль моста (curl через ssh) обязан идти с
# --noproxy '*': в окружении usbox http_proxy/https_proxy ведут на squid,
# и curl без --noproxy отдаёт мгновенный 403 от squid ДЛЯ ЛЮБОГО адреса,
# включая заведомо недостижимый -- замер достижимости без этого флага
# недействителен.
#
# CONSTRAINT: код возврата 0 возможен ТОЛЬКО после положительного контроля:
# подняв мост, инструмент сам гоняет через ssh curl к клиентскому порту
# и требует http=200. «Поднялось» без доказанного трафика нулём не выходит;
# любой отказ на подъёме -- код 2 с причиной словами.
#
# CONSTRAINT: подключение к площадке ЛЕНИВОЕ (при первом байте запроса):
# площадка закрывает неиспользуемые keep-alive соединения, и пул заранее
# подключённых сокетов сгнил бы в простое между клиентами.
#
# CONSTRAINT: перечень доставляемого на usbox читается из ОДНОГО места --
# структура DEPLOY ниже; второго списка доставляемых файлов нет и не бывает.
#
# Коды возврата: 0 -- мост служил, положительный контроль был зелёным,
#                снят сигналом/таймером с уборкой за собой;
#                2 -- отказ с названной причиной (площадка/ssh/диспетчер/
#                    каналы/контроль) либо мост развалился в службе.
#
# Пример (живая приёмка судьи на usbox через мост):
#   мак:   python3 scripts/judge-bridge.py            # до Ctrl-C
#   usbox: CATALYST_JUDGE_LIVE=1 \
#          ANTHROPIC_BASE_URL=http://127.0.0.1:18317 \
#          bash tests/scripts/test-judge-serves.sh
import argparse
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time

SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3']

DISPATCHER_NAME = 'judge-bridge-dispatch.py'

# Диспетчер -- отдельный маленький скрипт, исполняемый на usbox. Внутри него
# сознательно нет тройных кавычек и обратных слэшей: он хранится как
# строковый литерал в этом файле и доставляется на usbox через stdin ssh
# (без scp и без локальных промежуточных файлов).
DISPATCHER_SRC = '''
# Диспетчер моста судьи -- исполняется на usbox, доставляется и убирается
# стороной мака (scripts/judge-bridge.py на маке).
#
# CONSTRAINT: оба слушателя вяжутся ТОЛЬКО на 127.0.0.1 -- наружу машины
# мост не торчит.
# CONSTRAINT: один рабочий канал обслуживает ровно ОДНО клиентское
# соединение: по завершении пары канал закрывается, замену присылает мак.
# CONSTRAINT: маркер готовности пишется ТОЛЬКО в журнал, не в сокет:
# пробное соединение к служебному порту стало бы фантомным рабочим каналом
# и увело бы первого реального клиента в пустоту.
import argparse
import socket
import sys
import threading
import time

ARGS = None   # разбирается в main до старта потоков


def log(msg):
    sys.stderr.write('[dispatch %s] %s' % (time.strftime('%H:%M:%S'), msg))
    sys.stderr.write(chr(10))
    sys.stderr.flush()


class Pool:
    # Очередь свободных рабочих каналов; _ever -- был ли хоть один канал
    # (отличает «мост ещё не подключился» от «мост умер»). Атрибут намеренно
    # с подчёркиванием: одноимённый атрибут без подчёркивания затенял бы
    # метод ever() в словаре экземпляра (измерено вторым запуском).
    def __init__(self):
        self.cond = threading.Condition()
        self.free = []
        self._ever = False

    def put(self, sock):
        with self.cond:
            self.free.append(sock)
            self._ever = True
            self.cond.notify_all()

    def get(self, timeout):
        deadline = time.monotonic() + timeout
        with self.cond:
            while not self.free:
                left = deadline - time.monotonic()
                if left <= 0:
                    return None
                self.cond.wait(left)
            return self.free.pop(0)

    def size(self):
        with self.cond:
            return len(self.free)

    def ever(self):
        with self.cond:
            return self._ever


POOL = Pool()
ACTIVE = 0
ACTIVE_LOCK = threading.Lock()


def pump(src, dst):
    # Одно направление сплайса; EOF/ошибка передаётся как shutdown(WR) на
    # dst (полузакрытие), полное закрытие делает joiner пары, когда
    # закончились ОБА направления -- так ответ не срезается закрытием.
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass


def joiner(client, worker, t1, t2):
    global ACTIVE
    t1.join()
    t2.join()
    for s in (client, worker):
        try:
            s.close()
        except Exception:
            pass
    with ACTIVE_LOCK:
        ACTIVE -= 1


def serve_client(client):
    global ACTIVE
    worker = POOL.get(ARGS.wait_worker)
    if worker is None:
        log('нет свободного канала за %.0f с -- клиент закрыт без ответа'
            % ARGS.wait_worker)
        try:
            client.close()
        except Exception:
            pass
        return
    with ACTIVE_LOCK:
        ACTIVE += 1
    t1 = threading.Thread(target=pump, args=(client, worker), daemon=True)
    t2 = threading.Thread(target=pump, args=(worker, client), daemon=True)
    t1.start()
    t2.start()
    threading.Thread(target=joiner, args=(client, worker, t1, t2),
                     daemon=True).start()
    log('спарено: клиент с каналом (свободных осталось %d)' % POOL.size())


def listener(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', port))
    s.listen(16)
    return s


def accept_loop(sock, handler):
    while True:
        conn, _ = sock.accept()
        threading.Thread(target=handler, args=(conn,), daemon=True).start()


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument('--client-port', type=int, required=True)
    ap.add_argument('--service-port', type=int, required=True)
    ap.add_argument('--wait-worker', type=float, default=60.0)
    ap.add_argument('--idle-exit', type=float, default=900.0)
    ap.add_argument('--worker-grace', type=float, default=300.0)
    ARGS = ap.parse_args()
    service = listener(ARGS.service_port)
    client = listener(ARGS.client_port)
    threading.Thread(target=accept_loop, args=(service, POOL.put),
                     daemon=True).start()
    threading.Thread(target=accept_loop, args=(client, serve_client),
                     daemon=True).start()
    log('READY client=127.0.0.1:%d service=127.0.0.1:%d'
        % (ARGS.client_port, ARGS.service_port))
    # Сторож одиночества: каналами моста управляет мак; если ни один канал
    # не пришёл за worker_grace секунд после старта (мак умер между стартом
    # диспетчера и первым каналом) -- выйти; и если каналы БЫЛИ, но исчезли
    # на idle_exit секунд (мак умер/ушёл без уборки) -- тоже выйти. Брошенный
    # слушатель на чужой машине не остаётся ни в одном из случаев.
    started = time.monotonic()
    lonely_since = None
    while True:
        time.sleep(5)
        with ACTIVE_LOCK:
            active = ACTIVE
        if POOL.size() == 0 and active == 0:
            if not POOL.ever():
                if time.monotonic() - started >= ARGS.worker_grace:
                    log('ни один рабочий канал не пришёл за %.0f с -- выхожу'
                        % ARGS.worker_grace)
                    return
            else:
                if lonely_since is None:
                    lonely_since = time.monotonic()
                elif time.monotonic() - lonely_since >= ARGS.idle_exit:
                    log('рабочих каналов нет %.0f с -- выхожу (мак не пришёл)'
                        % ARGS.idle_exit)
                    return
        else:
            lonely_since = None


main()
'''

# Единственное место, где перечислено доставляемое на usbox.
DEPLOY = ((DISPATCHER_NAME, DISPATCHER_SRC),)


class Refusal(Exception):
    """Отказ на подъёме: код 2 с причиной словами."""


def ssh_run(host, cmd, timeout=60):
    return subprocess.run(['ssh'] + SSH_OPTS + [host, cmd],
                          capture_output=True, text=True, timeout=timeout)


def ssh_or_refuse(host, cmd, what, timeout=60):
    """ssh_run, но зависание -- это отказ с кодом 2, а не трейсбек.

    Таймаут ssh на подъёме моста -- диагностируемая причина (команда не
    завершилась), у отказа обязано быть имя, а у инструмента -- код 2.
    """
    try:
        return ssh_run(host, cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Refusal('%s: ssh-команда не завершилась за %d с: %s'
                      % (what, timeout, cmd[:200]))


class Worker:
    """Один рабочий канал: ssh-сессия с ncat на usbox <-> площадка на маке.

    Подключение к площадке ЛЕНИВОЕ: сокет создаётся при первом байте из
    usbox -- до того канал не занимает соединений с площадкой (см.
    CONSTRAINT в шапке про гниение простаивающего пула).
    """

    def __init__(self, proc, platform_addr, tag):
        self.proc = proc
        self.platform_addr = platform_addr
        self.tag = tag
        self.sock = None
        threading.Thread(target=self._up, daemon=True).start()

    def _up(self):
        # usbox -> площадка
        try:
            first = self.proc.stdout.read1(65536)
            if first:
                self.sock = socket.create_connection(self.platform_addr, 10)
                threading.Thread(target=self._down, daemon=True).start()
                self.sock.sendall(first)
                while True:
                    data = self.proc.stdout.read1(65536)
                    if not data:
                        break
                    self.sock.sendall(data)
        except Exception as exc:
            if self.sock is None:
                print('judge-bridge: канал %d: площадка недоступна в момент '
                      'запроса: %r -- канал погашен, клиент получит обрыв'
                      % (self.tag, exc))
            try:
                self.proc.kill()
            except Exception:
                pass
        finally:
            if self.sock is not None:
                try:
                    self.sock.shutdown(socket.SHUT_WR)
                except Exception:
                    pass

    def _down(self):
        # площадка -> usbox; EOF площадки закрывает stdin ssh -- ncat
        # закрывает канал, диспетчер видит закрытие и завершает пару.
        try:
            while True:
                data = self.sock.recv(65536)
                if not data:
                    break
                self.proc.stdin.write(data)
                self.proc.stdin.flush()
        except Exception:
            pass
        finally:
            try:
                self.proc.stdin.close()
            except Exception:
                pass


class Bridge:
    def __init__(self, args, platform_addr):
        self.args = args
        self.host = args.host
        self.platform_addr = platform_addr
        self.pool_size = args.pool
        self.workers = []
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.remote_dir = None
        self.dispatcher_pid = None
        self.spawned = 0
        self.fatal = None
        self.control_ok = False

    # --- подъём: площадка -> ssh -> диспетчер -> пул -> контроль --------------

    def raise_up(self):
        # 1. Площадка жива на маке (без этого мост бессмыслен).
        try:
            probe = socket.create_connection(self.platform_addr, 5)
            probe.close()
        except OSError as exc:
            raise Refusal('площадка %s:%d на маке не отвечает: %r'
                          % (self.platform_addr[0], self.platform_addr[1],
                             exc))

        # 2. ssh до usbox поднимается (BatchMode: никакого интерактива).
        r = ssh_or_refuse(self.host, 'echo ok', 'проверка ssh', timeout=30)
        if r.returncode != 0 or r.stdout.strip() != 'ok':
            raise Refusal('ssh %s не поднимается: rc=%d stderr=%r'
                          % (self.host, r.returncode, r.stderr.strip()[:200]))

        # 3. Свой временный каталог на usbox и доставка диспетчера (перечень
        #    файлов -- только DEPLOY, других доставок нет).
        r = ssh_or_refuse(self.host,
                          'mktemp -d "${TMPDIR:-/tmp}/judge-bridge.XXXXXX"',
                          'временный каталог')
        if r.returncode != 0 or not r.stdout.strip():
            raise Refusal('временный каталог на %s не создан: rc=%d stderr=%r'
                          % (self.host, r.returncode, r.stderr.strip()[:200]))
        self.remote_dir = r.stdout.strip()
        for name, src in DEPLOY:
            try:
                r = subprocess.run(
                    ['ssh'] + SSH_OPTS + [self.host,
                                          'cat > %s/%s' % (shlex.quote(self.remote_dir), name)],
                    input=src, text=True, capture_output=True, timeout=60)
            except subprocess.TimeoutExpired:
                raise Refusal('доставка %s на %s не завершилась за 60 с' % (name, self.host))
            if r.returncode != 0:
                raise Refusal('доставка %s на %s отказала: rc=%d stderr=%r'
                              % (name, self.host, r.returncode,
                                 r.stderr.strip()[:200]))

        # 4. Старт диспетчера (nohup: переживает ssh-сеанс) и ожидание READY.
        #    CONSTRAINT: редиректы стоят ВНУТРИ скобок на самой exec-команде --
        #    снаружи скобок файл открылся бы ДО cd (лог уезжал в $HOME), а без
        #    скобок вовсе фоновая команда наследовала бы stdout/stderr
        #    ssh-канала и ssh не вышел, пока жив диспетчер (оба измерены
        #    запусками 1 и 2). exec делает $! pid самого python3 -- уборка
        #    бьёт точно в него.
        r = ssh_or_refuse(self.host,
                          '( cd %s && exec nohup python3 %s --client-port %d'
                          ' --service-port %d'
                          ' > dispatch.log 2>&1 < /dev/null ) & echo PID=$!'
                          % (shlex.quote(self.remote_dir), DISPATCHER_NAME,
                             self.args.client_port, self.args.service_port),
                          'старт диспетчера')
        if r.returncode != 0 or 'PID=' not in r.stdout:
            raise Refusal('диспетчер на %s не стартовал: rc=%d stdout=%r stderr=%r'
                          % (self.host, r.returncode, r.stdout.strip()[:200],
                             r.stderr.strip()[:200]))
        try:
            self.dispatcher_pid = int(r.stdout.strip().split('PID=')[1].split()[0])
        except (ValueError, IndexError):
            raise Refusal('pid диспетчера не разобран из %r' % r.stdout)
        if not self._wait_dispatcher_ready(30):
            tail = ssh_or_refuse(self.host, 'tail -20 %s/dispatch.log'
                                 % shlex.quote(self.remote_dir),
                                 'журнал диспетчера', timeout=30)
            raise Refusal('диспетчер не встал: READY не появился за 30 с; '
                          'журнал (хвост):\n%s' % tail.stdout)

        # 5. Пул рабочих каналов: следящий поток восполняет, ждём осёдку.
        threading.Thread(target=self._supervise, daemon=True).start()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            with self.lock:
                n = len(self.workers)
            if n >= self.pool_size:
                break
            time.sleep(0.5)
        with self.lock:
            alive = len(self.workers)
        if alive == 0:
            raise Refusal('рабочие каналы не встали: ssh/ncat гаснут сразу '
                          '(живых %d из %d)' % (alive, self.pool_size))
        if alive < self.pool_size:
            print('judge-bridge: предупреждение: живых каналов %d из %d -- '
                  'продолжаю, следящий поток добирает' % (alive, self.pool_size))

        # 6. ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: мост сам доказывает, что несёт трафик.
        #    CONSTRAINT: --noproxy '*' обязателен -- иначе squid ответит 403
        #    за любой адрес, и замер ничего не доказывает.
        ctrl = ("curl -s --noproxy '*' -o /dev/null -w '%%{http_code}'"
                ' --max-time 30 http://127.0.0.1:%d%s'
                % (self.args.client_port, self.args.control_path))
        r = ssh_or_refuse(self.host, ctrl, 'положительный контроль', timeout=90)
        got = r.stdout.strip()
        if r.returncode != 0 or got != '200':
            raise Refusal('положительный контроль: ждали http=200, получили '
                          'rc=%d http=%r stderr=%r'
                          % (r.returncode, got, r.stderr.strip()[:200]))
        self.control_ok = True

        print('judge-bridge: МОСТ ПОДНЯТ: usbox http://127.0.0.1:%d -> мак '
              '%s:%d (пул %d, диспетчер pid %d в %s)'
              % (self.args.client_port, self.platform_addr[0],
                 self.platform_addr[1], self.pool_size, self.dispatcher_pid,
                 self.remote_dir))
        print('judge-bridge: положительный контроль: http=200 '
              'http://127.0.0.1:%d%s' % (self.args.client_port,
                                         self.args.control_path))

    def _wait_dispatcher_ready(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            r = ssh_or_refuse(self.host, 'grep -c READY %s/dispatch.log'
                              % shlex.quote(self.remote_dir),
                              'опрос готовности диспетчера', timeout=30)
            if r.returncode == 0 and r.stdout.strip() not in ('', '0'):
                return True
            time.sleep(0.5)
        return False

    # --- служба ----------------------------------------------------------------

    def _spawn_one(self):
        proc = subprocess.Popen(
            ['ssh'] + SSH_OPTS + [self.host,
                                  '/usr/bin/ncat 127.0.0.1 %d'
                                  % self.args.service_port],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        # Мгновенная смерть = канал не подключился (диспетчер умер/порт занят);
        # нормальный канал живёт до израсходования клиентом.
        time.sleep(1.0)
        if proc.poll() is not None:
            return False
        self.spawned += 1
        with self.lock:
            self.workers.append(Worker(proc, self.platform_addr, self.spawned))
        return True

    def _supervise(self):
        fails = 0
        while not self.stop_event.is_set():
            with self.lock:
                self.workers = [w for w in self.workers if w.proc.poll() is None]
                need = self.pool_size - len(self.workers)
            for _ in range(max(0, need)):
                if self._spawn_one():
                    fails = 0
                else:
                    fails += 1
                    break
            with self.lock:
                alive = len(self.workers)
            if alive == 0 and fails >= 3:
                self.fatal = ('все рабочие каналы погасли и не восстанавливаются'
                              ' (3 попытки подряд)')
                print('judge-bridge: ФАТАЛЬНО: %s' % self.fatal)
                self.stop_event.set()
                return
            self.stop_event.wait(0.5)

    def run_until_stop(self):
        end = time.monotonic() + self.args.duration if self.args.duration > 0 else None
        while not self.stop_event.is_set():
            self.stop_event.wait(1.0)
            if end is not None and time.monotonic() >= end:
                return 'таймер --duration %d с истёк' % self.args.duration
        if self.fatal:
            return 'фатально: %s' % self.fatal
        return 'сигнал'

    # --- уборка ----------------------------------------------------------------

    def cleanup(self):
        """Гасит СВОИ ssh-каналы, СВОЙ диспетчер, удаляет СВОЙ каталог на usbox.

        Чужие процессы и каталоги не трогаются: диспетчер гасится строго по
        записанному pid, каталог -- строго по пути из mktemp.
        """
        self.stop_event.set()
        with self.lock:
            workers = list(self.workers)
        for w in workers:
            try:
                w.proc.terminate()
            except Exception:
                pass
        for w in workers:
            try:
                w.proc.wait(timeout=3)
            except Exception:
                try:
                    w.proc.kill()
                except Exception:
                    pass
        if self.remote_dir:
            if self.dispatcher_pid:
                ssh_run(self.host, 'kill %d 2>/dev/null || true'
                        % self.dispatcher_pid, timeout=30)
                time.sleep(0.5)
            ssh_run(self.host, 'rm -rf %s' % shlex.quote(self.remote_dir),
                    timeout=60)
            r = ssh_run(self.host, 'test -e %s && echo LEFT || echo GONE'
                        % shlex.quote(self.remote_dir), timeout=30)
            state = r.stdout.strip() or ('НЕ ПРОВЕРЕН (rc=%d)' % r.returncode)
            print('judge-bridge: уборка: временный каталог на %s: %s'
                  % (self.host, state))
        with self.lock:
            alive_now = len(self.workers)
        print('judge-bridge: остановка: каналов поднято всего %d, причина: %s'
              % (self.spawned, getattr(self, '_stop_reason', 'снятие')))


def main():
    # Лог обязан быть строково-буферизованным и в файле (nohup > log): без
    # этого строки «МОСТ ПОДНЯТ»/предупреждения сидят в блочном буфере до
    # выхода, и дежурный по мосту не видит состояния (измерено запуском 3).
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(
        description='Мост usbox -> HTTP-площадка на маке (без ssh -R).')
    ap.add_argument('--host', default='usbox',
                    help='ssh-назначение машины-потребителя (умолчание usbox)')
    ap.add_argument('--platform', default='127.0.0.1:8317',
                    help='host:port площадки на маке')
    ap.add_argument('--client-port', type=int, default=18317,
                    help='порт для клиентов на usbox (умолчание 18317)')
    ap.add_argument('--service-port', type=int, default=18318,
                    help='служебный порт рабочих каналов на usbox (18318)')
    ap.add_argument('--pool', type=int, default=4,
                    help='размер пула рабочих каналов (умолчание 4)')
    ap.add_argument('--duration', type=int, default=0,
                    help='секунд держать мост; 0 -- до сигнала (умолчание 0)')
    ap.add_argument('--control-path', default='/',
                    help='путь положительного контроля (умолчание /)')
    args = ap.parse_args()

    try:
        host, port = args.platform.split(':')
        platform_addr = (host, int(port))
    except ValueError:
        print('judge-bridge: ОТКАЗ: --platform ждёт вид host:port, получено %r'
              % args.platform)
        sys.exit(2)

    bridge = None
    try:
        bridge = Bridge(args, platform_addr)
        bridge.raise_up()
    except Refusal as exc:
        if bridge is not None:
            bridge.cleanup()
        print('judge-bridge: ОТКАЗ: %s' % exc)
        sys.exit(2)

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: bridge.stop_event.set())
    try:
        bridge._stop_reason = bridge.run_until_stop()
    except KeyboardInterrupt:
        bridge._stop_reason = 'сигнал'
    bridge.cleanup()
    if bridge.fatal:
        sys.exit(2)
    if not bridge.control_ok:
        # Недостижимо на этом пути (контроль -- условие подъёма), но ноль
        # без доказанного трафика запрещён и здесь.
        sys.exit(2)
    print('judge-bridge: код 0: мост служил, положительный контроль был зелёным')
    sys.exit(0)


if __name__ == '__main__':
    main()
