#!/usr/bin/env python3
"""Свежесть УСТАНОВЛЕННОЙ копии плагина против её источника.

Зачем. «Закрыто по коммиту» не значит «действует»: живой хук сессии исполняет
не репозиторий, а КЭШ установки, и между ними три звена, каждое из которых
умеет отстать молча. Измерено 2026-09-14: дев-репозиторий стоял на `21abd1e`
и был запушен, зеркало маркетплейса -- на `e90739b`, установка верна зеркалу.
То есть отстало ЗЕРКАЛО, а не установка, и в бою работал гейт диспатча без
трёх дверей, закрытых задачей #145 (замерено по байтам: `EFFORT_WORDS` 6
вхождений в установленной копии против 9 в репозитории). Двери, которая
сказала бы об этом, не было ни одной.

Три ОСИ, и они разные -- смешивать нельзя, потому что чинятся по-разному:

  A. рабочая копия  vs  запись об установке   (исполняется не то, что учтено)
  B. установка      vs  зеркало маркетплейса  (переустановить)
  C. зеркало        vs  удалённый источник    (обновить маркетплейс)

Ось C требует сети. Её неизмеримость -- СВОЙ исход, а не зелёный: «эта машина
не смогла спросить» и «источник не двигался» неотличимы по пустому ответу, и
именно на этом различии кит уже платил (задача #101). Поэтому ось C либо
называет обе стороны, либо прямо говорит, что не измерена, и почему.

Коды возврата:
  0  измерено; расхождения (если есть) напечатаны в stdout
  2  прибор не может мерить: нет реестров установки/маркетплейсов, нет git

Печать -- только когда есть что сказать: на сошедшихся осях вывод пуст, чтобы
не съедать контекст каждой сессии шумом.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

PLUGIN_KEY = "catalyst@catalyst"
MARKETPLACE_KEY = "catalyst"

# Бюджет сетевого вопроса. Ось C не имеет права задержать старт сессии: лучше
# «не измерена», чем висящий терминал.
REMOTE_TIMEOUT_S = 6.0
# Как часто вообще спрашивать сеть. Зеркало двигается редко, а старт сессии
# случается десятки раз в день.
REMOTE_TTL_S = 6 * 3600


def claude_home() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")


def state_path() -> str:
    """Дом состояния -- НАШ, а не стоковый файл пользователя."""
    return os.path.join(claude_home(), "probes", "catalyst", "freshness.json")


def read_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def git_out(repo: str, *args: str, timeout: float | None = None) -> tuple[int, str]:
    """Код и вывод БЕЗ подавления: отказ git обязан быть отличим от пустоты."""
    try:
        p = subprocess.run(["git", "-C", repo, *args],
                           capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return 127, "git не найден"
    except subprocess.TimeoutExpired:
        return 124, f"git не ответил за {timeout} с"
    return p.returncode, (p.stdout.strip() or p.stderr.strip())


def short(sha: str) -> str:
    return sha[:12] if sha else "(нет)"


def relation(mirror: str, mirror_sha: str, remote_sha: str) -> str:
    """Направление расхождения зеркала и источника, ДОКАЗАННОЕ родством.

    «Не равны» само по себе не значит «зеркало отстало»: оно может быть и
    впереди. Цена этой подмены уплачена 2026-09-14 на живом доме -- дверь
    сказала «обновить маркетплейс», когда зеркало уже содержало тот коммит,
    который она считала источником.

    Исходы: same | mirror-contains (впереди либо кэш устарел) | mirror-behind
    | diverged | unknown (родство не установлено -- НЕ повод угадывать).
    """
    if remote_sha == mirror_sha:
        return "same"
    # Объекта нет в хранилище зеркала -> зеркало его ТОЧНО не содержит.
    # ls-remote объекты не приносит, так что это нормальный случай отставания.
    rc, _ = git_out(mirror, "cat-file", "-e", remote_sha + "^{commit}")
    if rc != 0:
        return "mirror-behind"
    rc, _ = git_out(mirror, "merge-base", "--is-ancestor", remote_sha, mirror_sha)
    if rc == 0:
        return "mirror-contains"
    if rc != 1:
        return "unknown"
    rc, _ = git_out(mirror, "merge-base", "--is-ancestor", mirror_sha, remote_sha)
    if rc == 0:
        return "mirror-behind"
    if rc != 1:
        return "unknown"
    return "diverged"


def main() -> int:
    home = claude_home()
    inst_path = os.path.join(home, "plugins", "installed_plugins.json")
    mkt_path = os.path.join(home, "plugins", "known_marketplaces.json")

    try:
        installed = read_json(inst_path)
        markets = read_json(mkt_path)
    except (OSError, ValueError) as exc:
        sys.stderr.write(f"plugin-freshness: ПРИБОР НЕ МЕРИТ -- реестры не прочитаны: {exc}\n")
        return 2

    entries = (installed.get("plugins") or {}).get(PLUGIN_KEY) or []
    if not entries:
        sys.stderr.write(f"plugin-freshness: ПРИБОР НЕ МЕРИТ -- в реестре нет {PLUGIN_KEY}\n")
        return 2
    entry = entries[0]
    inst_sha = entry.get("gitCommitSha") or ""
    inst_dir = entry.get("installPath") or ""
    inst_ver = entry.get("version") or "(нет)"

    market = markets.get(MARKETPLACE_KEY) or {}
    mirror = market.get("installLocation") or ""

    notes: list[str] = []

    # --- ось A: что ИСПОЛНЯЕТСЯ против того, что УЧТЕНО ---------------------
    # Корень берётся от площадки, а при её молчании -- от собственного файла:
    # хук может быть позван и напрямую.
    running = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    if inst_dir and os.path.realpath(running) != os.path.realpath(inst_dir):
        notes.append(
            f"ОСЬ A: исполняется копия {running}, а в реестре установки записана "
            f"{inst_dir} -- сверка свежести ниже относится к ЗАПИСАННОЙ, не к "
            f"исполняемой.")

    # --- ось B: установка против зеркала ------------------------------------
    if not mirror or not os.path.isdir(os.path.join(mirror, ".git")):
        notes.append(
            f"ОСЬ B НЕ ИЗМЕРЕНА: дом зеркала маркетплейса «{mirror or 'не назван'}» "
            f"не является git-клоном -- отстаёт установка или нет, сказать нечем.")
        mirror_sha = ""
    else:
        rc, mirror_sha = git_out(mirror, "rev-parse", "HEAD")
        if rc != 0:
            notes.append(f"ОСЬ B НЕ ИЗМЕРЕНА: git в зеркале отдал код {rc}: {mirror_sha}")
            mirror_sha = ""
        elif inst_sha and mirror_sha != inst_sha:
            rc2, behind = git_out(mirror, "rev-list", "--count", f"{inst_sha}..{mirror_sha}")
            count = f" (на {behind} коммит(ов))" if rc2 == 0 and behind.isdigit() else ""
            notes.append(
                f"ОСЬ B: установленная копия v{inst_ver} стоит на {short(inst_sha)}, "
                f"зеркало -- на {short(mirror_sha)}{count}. Переустановить плагин.")

    # --- ось C: зеркало против удалённого источника --------------------------
    # Спрашивается не чаще TTL и НИКОГДА не молчит о собственной неудаче.
    if mirror_sha:
        remote_sha, why = cached_remote(mirror, mirror_sha)
        if remote_sha is None:
            notes.append(
                f"ОСЬ C НЕ ИЗМЕРЕНА: удалённый источник не опрошен ({why}). "
                f"«Источник не двигался» и «эта машина не смогла спросить» дают "
                f"один и тот же пустой ответ -- поэтому здесь не зелёное, а "
                f"«не измерено».")
        else:
            rel = relation(mirror, mirror_sha, remote_sha)
            if rel == "mirror-behind":
                notes.append(
                    f"ОСЬ C: зеркало маркетплейса стоит на {short(mirror_sha)}, "
                    f"удалённый источник -- на {short(remote_sha)}. Обновить "
                    f"маркетплейс, иначе переустановка принесёт те же байты.")
            elif rel == "diverged":
                notes.append(
                    f"ОСЬ C: зеркало {short(mirror_sha)} и источник "
                    f"{short(remote_sha)} РАЗОШЛИСЬ -- у каждого есть коммиты, "
                    f"которых нет у другого. Обновление маркетплейса этого не "
                    f"сведёт: разбираться с зеркалом руками.")
            elif rel == "unknown":
                notes.append(
                    f"ОСЬ C НЕ ИЗМЕРЕНА: зеркало {short(mirror_sha)} и источник "
                    f"{short(remote_sha)} различны, но родство не установлено -- "
                    f"направление расхождения назвать нечем, а угаданное "
                    f"направление хуже отсутствующего.")
            # same / mirror-contains -- молчим: обновлять маркетплейс НЕЧЕМ.
            # «Впереди» -- нормальное состояние сразу после пуша из дев-дома,
            # и требовать за него действия значит звать оператора впустую.

    if notes:
        print("!! CATALYST: установленная копия расходится со своим источником.")
        for n in notes:
            print("   " + n)
    return 0


def cached_remote(mirror: str, mirror_sha: str) -> tuple[str | None, str]:
    """Sha удалённого HEAD с кэшем по времени. None -- НЕ измерено, с причиной."""
    path = state_path()
    now = time.time()
    try:
        st = read_json(path)
    except (OSError, ValueError):
        st = {}
    rec = st.get(mirror) or {}
    cached = rec.get("sha")
    if cached and (now - float(rec.get("at", 0))) < REMOTE_TTL_S:
        # Срок -- не единственное условие годности. Значение, которое зеркало
        # УЖЕ содержит, устарело по построению: источник с тех пор как минимум
        # дошёл до этой точки, а мы читаем снимок «до». Именно так дверь
        # 2026-09-14 позвала обновлять маркетплейс через 23 минуты после
        # собственного пуша. Такой кэш не продлеваем -- спрашиваем заново.
        if relation(mirror, mirror_sha, cached) != "mirror-contains":
            return cached, "из кэша"

    rc, out = git_out(mirror, "ls-remote", "origin", "HEAD", timeout=REMOTE_TIMEOUT_S)
    if rc != 0 or not out:
        # Отрицательный ответ НЕ кэшируется: иначе одна оборванная сеть
        # закрывала бы ось C на весь TTL.
        return None, f"git ls-remote отдал код {rc}: {out[:120]}"
    sha = out.split()[0]

    st[mirror] = {"sha": sha, "at": now}
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + f".new.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(st, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except OSError:
        # Запись состояния -- удобство, а не замер: её отказ не делает
        # измеренную ось неизмеренной.
        pass
    return sha, "спрошено"


if __name__ == "__main__":
    sys.exit(main())
