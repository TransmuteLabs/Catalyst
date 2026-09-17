#!/usr/bin/env python3
"""Статический прибор сверки слоёв эффорта Agent-канала.

Предмет: объявленный агенту effort (frontmatter-поле `effort:` в доме агентов)
против допуска его модели — секция [pins] в hooks/routing-table.toml. Живой
гейт диспатча отвергает несовпадение ДОСЛОВНО (замер 16.09):

    model 'glm-5.3' runs at ['max'] (accepted-effort pin), got 'high'

— но гейт видит только ВЫЗОВ, который уже состоялся: агент с заведомо
невозможным эффортом не запускается вовсе, и цену класса уже заплатили
(glm-auditor молча не работал; нашёл человек, а не прибор — ценз
CENSUS-effort-layers-233.md). Прибор закрывает класс статически, до диспатча.

Три слоя (термины ценза):
  L2 frontmatter агента -- `effort:` и `model:` в YAML-шапке файла агента;
  L3 машинная таблица  -- [pins] (допуск эффорта по модели),
                          [channels.agent].effort_required_for (для кого гейт
                          ОБЯЗАН требовать effort),
                          [quota].guarded_models (Anthropic-носители: effort
                          нативный, не требуется);
  боевая копия таблицы -- живой экземпляр плагина; сверка по БАЙТАМ (sha256),
                          класс «закоммичено != действует», который уже стоил
                          волне #234 ложного отказа.

КРАСНЫЕ классы — ровно пять (R1-R4 закрыты §2 брифа #233, R5 — адъюдикация
контроллера той же волны; прибор воспроизводит критерий живого гейта,
а не более широкий):
  R1 эффорт вне допуска: агент с effort, модель названа в [pins], значение
     вне списка — та же семантика, что у отказа живого гейта;
  R2 объявлен без дома при обязательности: модели НЕТ в [pins], но она входит
     в effort_required_for — гейт потребует эффорт, а сверить его не с чем;
  R3 эффорт обязателен и не объявлен: агент без effort на модели из
     effort_required_for;
  R4 копии таблицы разошлись: исходник против боевой копии, обе суммы
     в сообщении. Отсутствие боевой копии (например на Linux) — НЕ красный,
     а счётчик «боевой копии нет»;
  R5 файл агента не разобран: *.md в доме агентов без YAML-шапки либо без
     поля model — ДВЕ различимые причины, каждая названа в сообщении своим
     текстом. Основание (адъюдикация): неразобранный файл проходит мимо
     ВСЕЙ проверки молча, а гейт диспатча такой агент всё равно не примет —
     ошибаться в сторону шума, не пропуска.

НЕ красные — счётчики (полный перечень, чтобы молчание не читалось как
проверенность):
  «объявлен без дома» — модель с effort без строки в [pins] и вне
     effort_required_for (форма union-alpha: stealth/union-alpha);
  «без эффорта (законно, Anthropic)» — агент без effort на модели из
     [quota].guarded_models: таблица прямо разрешает («effort нативный»);
  «без эффорта (вне effort_required_for)» — гейт эффорта не требует;
  «расхождений описания с frontmatter» — ТОЛЬКО счётчик: пин принадлежит
     КЛЕТКЕ, а frontmatter у агента один, поэтому агент на нескольких клетках
     законно называет в описании разные значения (deepseek-flash-critic:
     crit-mech max, crit-form/doc xhigh — не дефект);
  «не разобрано» — знаменатель R5 (сколько файлов дали R5).

Порядок вердикта: R4 раньше пустого предмета — разошедшиеся копии обесценивают
любое измерение по ним, и этот класс уже стоил волне #234; пустой предмет при
красном R4 не гасит его кодом 3, а называется примечанием. Пустой предмет без
красных — код 3, НЕ 0: пусто != ноль (форма ladder-policy.py, #231).

Коды возврата (контракт агрегатора tests/run-all.sh):
  0 — красных нет; ОДНА итоговая строка со всеми знаменателями;
  1 — красное нарушение: агент/модель/эффорт/допуск названы дословно (stdout);
  2 — ПРИБОР НЕДОСТУПЕН (stderr): нет tomllib/таблицы, неверная форма секций,
       нечитаемая боевая копия, неизвестный аргумент — до любой работы;
  3 — НЕ ИЗМЕРЕНО: дом агентов недоступен/пуст, ни одного разобранного
       агента, либо в [pins] нет ни одной записи.

Инъекция путей (форма #231): --agents/--table/--live и параметры main() --
зубы подкладывают синтетику, живые дома не читаются. env принят для
единообразия сигнатуры; env-ручек у прибора нет.
"""
import contextlib
import hashlib
import io
import os
import re
import sys
import tempfile

try:
    import tomllib
except ImportError:  # Python < 3.11 — fail-closed с названной причиной
    tomllib = None


def tool_root():
    """Корень репозитория: tests/scripts/effort-layers.py -> <repo>."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_toml(path):
    """(data, None) или (None, причина) — никогда не бросает."""
    if tomllib is None:
        return None, ("python tomllib is unavailable (Python >= 3.11 required) — "
                      f"cannot read {path}")
    try:
        with open(path, "rb") as f:
            return tomllib.load(f), None
    except FileNotFoundError:
        return None, f"файл не найден: {path}"
    except (tomllib.TOMLDecodeError, OSError) as e:
        return None, f"не читается как TOML: {path}: {e}"


# --- разбор файла агента ------------------------------------------------------
# CONSTRAINT: только простые `key: value` строки шапки; сложный YAML (списки,
# блоки) в доме агентов не встречается (ценз 17.09: 54/54 файла), а тяга
# yaml-парсера сделала бы прибор зависимым от пакета, которого нет.
FRONTMATTER_KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$")
# CONSTRAINT: границы слов обязательны: без них «xhigh» ловился бы как «high»,
# а «swallowed» (тело glm-critic) — как «low» (ложные попадания ценза).
EFFORT_VALUE_RE = re.compile(r"\b(xhigh|high|medium|low|max)\b")
# Якорь пина в описании: «effort»/«пин»/«pin» СЛОВОМ — «незапиненные»
# (grok-auditor) якорем не считается.
DESC_ANCHOR_RE = re.compile(r"(?iu)\b(?:пин|pin|effort)\b")
# CONSTRAINT: значение — ПЕРВОЕ в окне после якоря, не все: «high = max,
# дешевле» в скобках — сравнение веера, а не второй пин; жадный сбор давал бы
# ложное расхождение (qwen-flash-auditor, замер ценза).
DESC_WINDOW = 80


def unquote(value):
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1].strip()
    return v


def parse_agent(path):
    """(fields, None) или (None, причина). fields — словарь полей шапки."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        return None, f"не читается: {e}"
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, "нет frontmatter"
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None, "frontmatter не закрыт"
    fields = {}
    for line in lines[1:end]:
        m = FRONTMATTER_KEY_RE.match(line)
        if m and m.group(1).lower() not in fields:
            fields[m.group(1).lower()] = unquote(m.group(2))
    return fields, None


def description_claim(description):
    """Первое значение эффорта, названное в описании у якоря, или None."""
    if not description:
        return None
    for m in DESC_ANCHOR_RE.finditer(description):
        found = EFFORT_VALUE_RE.search(description[m.end():m.end() + DESC_WINDOW])
        if found:
            return found.group(1)
    return None


def summary_line(stats, violation_count):
    """Итоговая строка со всеми знаменателями — единый дом чисел отчёта."""
    head = (f"агентов {stats['agents']} (с эффортом {stats['with_effort']}, "
            f"без эффорта {stats['without_effort']}, "
            f"не разобрано: {stats['unparsed']})")
    no_home = ", ".join(f"{m} ×{n}" for m, n in sorted(stats["no_home"].items()))
    no_home_txt = (f"объявлен без дома: {sum(stats['no_home'].values())} "
                   f"({no_home})") if no_home else "объявлен без дома: 0"
    if stats["live_missing"]:
        live_txt = f"боевой копии нет: {stats['live_path']}"
    elif stats["live_diff"]:
        # CONSTRAINT: при расхождении копий итог НЕ имеет права печатать
        # «идентична» — строка итога не смеет противоречить нарушению R4.
        live_txt = (f"боевая копия РАСХОДИТСЯ (исходник sha256 "
                    f"{stats['table_sum']}, боевая sha256 "
                    f"{stats['live_diff']})")
    else:
        live_txt = (f"боевая копия идентична "
                    f"(sha256 {stats['table_sum']})")
    return (f"{head}; таблица {stats['table_path']}: нарушений {violation_count}; "
            f"моделей в [pins] {stats['pins_count']}, "
            f"в effort_required_for {stats['required_count']}; "
            f"{no_home_txt}; "
            f"без эффорта (законно, Anthropic): {stats['lawful']}; "
            f"без эффорта (вне effort_required_for): {stats['not_required']}; "
            f"расхождений описания с frontmatter: {stats['desc_div']}; "
            f"{live_txt}")


def check_layers(agents_dir, table_path, live_path):
    """(reason2, subject3, violations, stats).

    reason2 не None — прибор недоступен (код 2), причина названа.
    subject3 не None — предмет пуст (код 3), причина названа; при непустых
    violations красное важнее (R4 не гасится пустым предметом).
    violations — строки R1-R4. stats — счётчики итоговой строки.
    """
    stats = {
        "agents": 0, "with_effort": 0, "without_effort": 0, "unparsed": 0,
        "no_home": {}, "lawful": 0, "not_required": 0, "desc_div": 0,
        "pins_count": 0, "required_count": 0, "live_missing": False,
        "live_diff": "",
        "table_sum": "", "live_path": live_path, "table_path": table_path,
    }
    tab, err = load_toml(table_path)
    if err is not None:
        return f"таблица маршрутизации: {err}", None, None, None
    pins = tab.get("pins", {})
    if not isinstance(pins, dict):
        return (f"таблица {table_path}: секция [pins] не таблица — "
                "допуск эффорта не разобран"), None, None, None
    channels = tab.get("channels", {})
    if not isinstance(channels, dict):
        return (f"таблица {table_path}: секция [channels] не таблица"), None, None, None
    agent_channel = channels.get("agent", {})
    if not isinstance(agent_channel, dict):
        return (f"таблица {table_path}: секция [channels.agent] не таблица — "
                "обязательность эффорта не разобрана"), None, None, None
    required = agent_channel.get("effort_required_for", [])
    if not isinstance(required, list):
        return (f"таблица {table_path}: [channels.agent].effort_required_for "
                "не список — обязательность эффорта не разобрана"), None, None, None
    quota = tab.get("quota", {})
    if not isinstance(quota, dict):
        return f"таблица {table_path}: секция [quota] не таблица", None, None, None
    guarded = quota.get("guarded_models", [])
    if not isinstance(guarded, list):
        return (f"таблица {table_path}: [quota].guarded_models не список — "
                "признак Anthropic-носителя не разобран"), None, None, None
    required_set = {str(x) for x in required}
    guarded_set = {str(x) for x in guarded}
    stats["pins_count"] = len(pins)
    stats["required_count"] = len(required_set)

    # --- R4: две копии таблицы, сверка по байтам (sha256), до предмета -----
    try:
        with open(table_path, "rb") as f:
            table_bytes = f.read()
    except OSError as e:
        return f"таблица не читается: {e}", None, None, None
    stats["table_sum"] = hashlib.sha256(table_bytes).hexdigest()
    violations = []
    if os.path.isfile(live_path):
        try:
            with open(live_path, "rb") as f:
                live_bytes = f.read()
        except OSError as e:
            return f"боевая копия не читается: {live_path}: {e}", None, None, None
        live_sum = hashlib.sha256(live_bytes).hexdigest()
        if live_sum != stats["table_sum"]:
            stats["live_diff"] = live_sum
            violations.append(
                f"НАРУШЕНИЕ R4 копии-таблицы-разошлись: исходник {table_path} "
                f"sha256 {stats['table_sum']} != боевая {live_path} sha256 "
                f"{live_sum} — закоммичено != действует")
    else:
        stats["live_missing"] = True

    # --- предмет: дом агентов ----------------------------------------------
    files = []
    subject3 = None
    if not os.path.isdir(agents_dir):
        subject3 = f"дом агентов не найден: {agents_dir}"
    else:
        # CONSTRAINT: предмет — только *.md (файлы, не каталоги). Этим
        # гарантируется, что посторонний файл (например .DS_Store или notes.txt)
        # не порождает R5: он не попадает ни в знаменатель, ни в разбор.
        files = sorted(fn for fn in os.listdir(agents_dir)
                       if fn.endswith(".md") and os.path.isfile(
                           os.path.join(agents_dir, fn)))
        if not files:
            subject3 = f"в доме агентов нет ни одного .md: {agents_dir}"
    if subject3 is None and not pins:
        subject3 = (f"в [pins] таблицы {table_path} нет ни одной записи — "
                    "сверять эффорт не с чем")

    pin_shape_error = None
    if subject3 is None:
        for fn in files:
            stats["agents"] += 1
            fields, why = parse_agent(os.path.join(agents_dir, fn))
            # R5, причина 1: шапку установить не удалось (нет/не закрыта/
            # не читается — для предмета это одно: usable-шапки нет).
            if fields is None or why is not None:
                violations.append(
                    f"НАРУШЕНИЕ R5 файл-агента-не-разобран: {fn}: "
                    "нет YAML-шапки")
                stats["unparsed"] += 1
                continue
            model = fields.get("model")
            # R5, причина 2: шапка есть, а поля model в ней нет.
            if not model:
                violations.append(
                    f"НАРУШЕНИЕ R5 файл-агента-не-разобран: {fn}: "
                    "в шапке нет поля model")
                stats["unparsed"] += 1
                continue
            effort = fields.get("effort") or None
            if effort:
                stats["with_effort"] += 1
                if model in pins:
                    pin_list = pins[model]
                    if not isinstance(pin_list, list):
                        # CONSTRAINT: «записи нет» и «запись не того вида» —
                        # разные починки; форма записи — часть прибора, молча
                        # пропускать или натягивать смысл нельзя.
                        if pin_shape_error is None:
                            pin_shape_error = (
                                f"[pins].{model} не список "
                                f"({type(pin_list).__name__}) — допуск "
                                "эффорта не разобран")
                    elif effort not in (str(x) for x in pin_list):
                        shown = ", ".join(str(x) for x in pin_list)
                        violations.append(
                            f"НАРУШЕНИЕ R1 эффорт-вне-допуска: агент {fn}: "
                            f"model '{model}' runs at [{shown}] "
                            f"(accepted-effort pin), got '{effort}'")
                elif model in required_set:
                    violations.append(
                        f"НАРУШЕНИЕ R2 объявлен-без-дома: агент {fn}: модель "
                        f"'{model}' не названа в [pins], но входит в "
                        f"effort_required_for — гейт потребует эффорт, а "
                        f"сверить '{effort}' не с чем")
                else:
                    stats["no_home"][model] = stats["no_home"].get(model, 0) + 1
                claim = description_claim(fields.get("description", ""))
                if claim is not None and claim != effort:
                    stats["desc_div"] += 1
            else:
                stats["without_effort"] += 1
                if model in required_set:
                    violations.append(
                        f"НАРУШЕНИЕ R3 эффорт-обязателен: агент {fn}: модель "
                        f"'{model}' в effort_required_for, а effort во "
                        "frontmatter не объявлен")
                elif model in guarded_set:
                    stats["lawful"] += 1
                else:
                    stats["not_required"] += 1
        # CONSTRAINT: страховка от молчаливой зелени — при живом R5 ветка
        # недостижима (каждый неразобранный файл уже дал нарушение, код 1
        # раньше), но если проверку R5 вырвут, дом ТОЛЬКО из неразобранных
        # файлов обязан остановиться как НЕ ИЗМЕРЕННЫЙ, а не пройти зелёным.
        if stats["agents"] and stats["agents"] == stats["unparsed"]:
            subject3 = (f"ни одного разобранного агента в {agents_dir} "
                        f"({stats['unparsed']} файлов не разобрано)")
        if pin_shape_error is not None:
            return (f"таблица {table_path}: {pin_shape_error}"), None, None, None
    return None, subject3, violations, stats


# --- самопроверка: зубы на синтетике, живые дома не читаются ------------------
TABLE_OK = """schema_version = 1

[pins]
"glm-5.3" = ["max"]
"grok-4.6" = ["medium", "max"]

[channels.agent]
effort_required_for = ["glm-5.3", "grok-4.6", "madeup-9"]

[quota]
guarded_models = ["opus", "fable"]
"""

TABLE_NO_PINS = """schema_version = 1

[channels.agent]
effort_required_for = ["glm-5.3"]

[quota]
guarded_models = ["opus"]
"""


def agent_md(model=None, effort=None, description="Агент для зубов прибора."):
    lines = ["---", "name: probe-agent",
             f"description: {description}", "tools: Read"]
    if model is not None:
        lines.append(f"model: {model}")
    if effort is not None:
        lines.append(f"effort: {effort}")
    lines += ["---", "", "Тело агента."]
    return "\n".join(lines) + "\n"


def self_check():
    """Зубы прибора на синтетических входах, офлайн. 0 — все зелёны."""
    teeth = []

    def tooth(name, ok, detail=""):
        teeth.append((name, bool(ok), detail))

    with tempfile.TemporaryDirectory(prefix="effort-layers-selfcheck-") as work:

        def world(tag, agents, table_text=TABLE_OK, live_text=TABLE_OK):
            base = os.path.join(work, tag)
            agents_dir = os.path.join(base, "agents")
            os.makedirs(agents_dir)
            for fn, text in agents.items():
                with open(os.path.join(agents_dir, fn), "w", encoding="utf-8") as f:
                    f.write(text)
            table = os.path.join(base, "hooks", "routing-table.toml")
            os.makedirs(os.path.dirname(table))
            with open(table, "w", encoding="utf-8") as f:
                f.write(table_text)
            live = os.path.join(base, "home", ".claude", "plugins",
                                "marketplaces", "catalyst", "hooks",
                                "routing-table.toml")
            if live_text is not None:
                os.makedirs(os.path.dirname(live))
                with open(live, "w", encoding="utf-8") as f:
                    f.write(live_text)
            return base, agents_dir, table, live

        def capture(argv, root=None, home=None):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv, root=root, env={}, home=home)
            return rc, out.getvalue(), err.getvalue()

        # зуб 1 (положительный контроль): допустимые агенты + идентичные копии
        _b, a, t, l = world("pos", {
            "ok-glm.md": agent_md("glm-5.3", "max"),
            "ok-grok.md": agent_md("grok-4.6", "medium"),
            "lawful.md": agent_md("opus", None),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("положительный контроль: согласованное дерево -> код 0",
              rc == 0 and "нарушений 0" in out and "агентов 3" in out
              and "с эффортом 2" in out
              and "моделей в [pins] 2, в effort_required_for 3" in out
              and "без эффорта (законно, Anthropic): 1" in out
              and "боевая копия идентична" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 2: эффорт вне допуска -> R1 дословно как отказ живого гейта
        _b, a, t, l = world("r1", {
            "glm-aud.md": agent_md("glm-5.3", "high"),
            "ok-grok.md": agent_md("grok-4.6", "medium"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("эффорт вне допуска -> R1 с агентом, моделью и допуском",
              rc == 1 and "НАРУШЕНИЕ R1" in out and "glm-aud.md" in out
              and "'glm-5.3' runs at [max]" in out and "got 'high'" in out
              and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 3: модель вне [pins], но в effort_required_for -> R2
        _b, a, t, l = world("r2", {
            "req.md": agent_md("madeup-9", "high"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("объявлен без дома при обязательности -> R2",
              rc == 1 and "НАРУШЕНИЕ R2" in out and "madeup-9" in out
              and "effort_required_for" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 4: модель вне [pins] и вне effort_required_for -> счётчик, не красный
        _b, a, t, l = world("nohome", {
            "orph.md": agent_md("orphan-1", "high"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("объявлен без дома вне обязательности -> счётчик, код 0",
              rc == 0 and "НАРУШЕНИЕ" not in out
              and "объявлен без дома: 1 (orphan-1 ×1)" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 5: нет эффорта на обязательной модели -> R3
        _b, a, t, l = world("r3", {
            "bare.md": agent_md("madeup-9", None),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("эффорт обязателен и не объявлен -> R3",
              rc == 1 and "НАРУШЕНИЕ R3" in out and "madeup-9" in out
              and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 6: без эффорта на необязательной модели -> счётчик, не красный
        _b, a, t, l = world("loose", {
            "norq.md": agent_md("orphan-1", None),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("без эффорта вне effort_required_for -> счётчик, код 0",
              rc == 0 and "вне effort_required_for): 1" in out
              and "НАРУШЕНИЕ" not in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 7: пустой предмет -> код 3 (нет дома / пуст / нет [pins]).
        # Случай «все файлы не разобраны» сюда НЕ входит: с R5 такой дом
        # красный (зуб 15), а не пустой.
        cases7 = []
        _b, a, t, l = world("empty-dir", {})
        cases7.append(capture(["--agents", a, "--table", t, "--live", l]))
        _b, a, t, l = world("no-dir", {"x.md": agent_md("glm-5.3", "max")})
        cases7.append(capture(["--agents", os.path.join(a, "no-such"),
                               "--table", t, "--live", l]))
        _b, a, t, l = world("no-pins", {"x.md": agent_md("glm-5.3", "max")},
                            table_text=TABLE_NO_PINS, live_text=TABLE_NO_PINS)
        cases7.append(capture(["--agents", a, "--table", t, "--live", l]))
        tooth("пустой предмет (нет дома/пуст/нет [pins]) -> код 3",
              all(rc == 3 and "НЕ ИЗМЕРЕНО" in out and err == ""
                  for rc, out, err in cases7),
              f"cases={cases7!r}")

        # зуб 8: неизвестный аргумент и флаг без пути -> код 2 ДО работы
        rc8a, out8a, err8a = capture(["--bogus"])
        rc8b, out8b, err8b = capture(["--agents"])
        tooth("неизвестный аргумент / флаг без пути -> код 2 в stderr",
              rc8a == 2 and out8a == "" and "неизвестный аргумент: --bogus" in err8a
              and rc8b == 2 and out8b == "" and "--agents без пути" in err8b,
              f"a=({rc8a}, {out8a!r}, {err8a!r}) b=({rc8b}, {out8b!r}, {err8b!r})")

        # зуб 9: копии таблицы разошлись -> R4 с обеими суммами
        _b, a, t, l = world("copies", {"ok.md": agent_md("glm-5.3", "max")},
                            live_text=TABLE_OK + '\n[extra]\nx = 1\n')
        sum_t = hashlib.sha256(open(t, "rb").read()).hexdigest()
        sum_l = hashlib.sha256(open(l, "rb").read()).hexdigest()
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("копии таблицы разошлись -> R4 с обеими суммами",
              rc == 1 and "НАРУШЕНИЕ R4" in out and sum_t in out
              and sum_l in out and "боевая копия РАСХОДИТСЯ" in out
              and "боевая копия идентична" not in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 10: боевой копии нет -> НЕ красный, счётчик назван
        _b, a, t, l = world("nolive", {"ok.md": agent_md("glm-5.3", "max")},
                            live_text=None)
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("боевой копии нет -> счётчик, код 0",
              rc == 0 and "боевой копии нет" in out and "НАРУШЕНИЕ" not in out
              and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 11: таблица недоступна (нет файла / не TOML) -> код 2
        rc11a, out11a, err11a = capture(
            ["--agents", work, "--table", os.path.join(work, "no-table.toml")])
        bad_toml = os.path.join(work, "bad.toml")
        with open(bad_toml, "w", encoding="utf-8") as f:
            f.write("x = [\n")
        rc11b, out11b, err11b = capture(["--agents", work, "--table", bad_toml])
        tooth("таблицы нет / не TOML -> код 2 с путём",
              rc11a == 2 and out11a == "" and "no-table.toml" in err11a
              and rc11b == 2 and out11b == "" and "не читается как TOML" in err11b,
              f"a=({rc11a}, {err11a!r}) b=({rc11b}, {err11b!r})")

        # зуб 12: расхождение описания с frontmatter -> счётчик, НЕ красный
        _b, a, t, l = world("desc", {
            "div.md": agent_md("glm-5.3", "max",
                               description="Клетки: crit; пин effort xhigh — "
                                           "веер #1"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("описание называет другое значение -> счётчик, код 0",
              rc == 0 and "НАРУШЕНИЕ" not in out
              and "расхождений описания с frontmatter: 1" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 13: сравнение веера в скобках — НЕ второй пин (ложных ноль)
        _b, a, t, l = world("desc-ok", {
            "ok.md": agent_md(
                "glm-5.3", "max",
                description="пин effort max (веер #9: high = max, дешевле)"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("«high = max» в скобках — не расхождение",
              rc == 0 and "расхождений описания с frontmatter: 0" in out
              and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 14: умолчания путей (root/home) измеряют то же дерево, что флаги
        base, a, t, l = world("defaults", {
            "ok-glm.md": agent_md("glm-5.3", "max"),
            "lawful.md": agent_md("fable", None),
        })
        home_root = os.path.join(base, "home")
        agents_default = os.path.join(home_root, ".claude", "agents")
        os.makedirs(agents_default)
        for fn in os.listdir(a):
            with open(os.path.join(a, fn), encoding="utf-8") as src:
                with open(os.path.join(agents_default, fn), "w",
                          encoding="utf-8") as dst:
                    dst.write(src.read())
        rc, out, err = capture([], root=base, home=home_root)
        tooth("умолчания root/home -> тот же предмет без флагов",
              rc == 0 and "агентов 2" in out and "законно, Anthropic): 1" in out
              and "боевая копия идентична" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 15 (R5, причина 1): *.md без шапки -> красный с именем файла;
        # посторонний файл ДРУГОГО расширения R5 не вызывает (предмет -- *.md)
        _b, a, t, l = world("r5-noheader", {
            "broken.md": "нет шапки\n",
            "notes.txt": "посторонний файл\n",
            "ok.md": agent_md("glm-5.3", "max"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("R5: *.md без YAML-шапки -> красный; не-*.md игнорируется",
              rc == 1 and "НАРУШЕНИЕ R5" in out and "broken.md" in out
              and "нет YAML-шапки" in out and "notes.txt" not in out
              and "не разобрано: 1" in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

        # зуб 16 (R5, причина 2): шапка есть, поля model нет -> своя причина,
        # отличимая текстом от причины 1
        _b, a, t, l = world("r5-nomodel", {
            "nomodel.md": agent_md(None, "max"),
        })
        rc, out, err = capture(["--agents", a, "--table", t, "--live", l])
        tooth("R5: шапка без model -> красный с причиной, отличной от «нет шапки»",
              rc == 1 and "НАРУШЕНИЕ R5" in out and "nomodel.md" in out
              and "в шапке нет поля model" in out
              and "нет YAML-шапки" not in out and err == "",
              f"rc={rc} out={out!r} err={err!r}")

    for i, (name, ok, detail) in enumerate(teeth, 1):
        if ok:
            print(f"зуб {i} {name}: зелёный")
        else:
            print(f"зуб {i} {name}: КРАСЕН — {detail}")
    if all(ok for _, ok, _ in teeth):
        print(f"зубов {len(teeth)}, все зелёны")
        return 0
    print(f"зубов {len(teeth)}, красных {sum(1 for _, ok, _ in teeth if not ok)}")
    return 1


VALUED_FLAGS = {
    "--agents": "agents",
    "--table": "table",
    "--live": "live",
}


def parse_args(argv):
    """(opts, None) или (None, причина). Неизвестное — ошибка ДО работы."""
    opts = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--self-check":
            opts["self_check"] = True
        elif arg in VALUED_FLAGS:
            if i + 1 >= len(argv):
                return None, f"{arg} без пути"
            opts[VALUED_FLAGS[arg]] = argv[i + 1]
            i += 1
        else:
            return None, f"неизвестный аргумент: {arg}"
        i += 1
    return opts, None


def main(argv, root=None, env=None, home=None):
    root = tool_root() if root is None else root
    homed = os.path.expanduser("~") if home is None else home
    # env принят для единообразия сигнатуры #231; env-ручек у прибора нет.
    opts, err = parse_args(argv)
    if err is not None:
        print(f"ПРИБОР НЕДОСТУПЕН: {err}", file=sys.stderr)
        return 2
    if opts.get("self_check"):
        return self_check()

    table_path = opts.get("table") or os.path.join(root, "hooks",
                                                   "routing-table.toml")
    agents_dir = opts.get("agents") or os.path.join(homed, ".claude", "agents")
    live_path = opts.get("live") or os.path.join(
        homed, ".claude", "plugins", "marketplaces", "catalyst", "hooks",
        "routing-table.toml")

    reason2, subject3, violations, stats = check_layers(
        agents_dir, table_path, live_path)
    if reason2 is not None:
        print(f"ПРИБОР НЕДОСТУПЕН: {reason2}", file=sys.stderr)
        return 2
    if violations:
        for v in violations:
            print(v)
        print(summary_line(stats, len(violations)))
        if subject3 is not None:
            print(f"ПРИМЕЧАНИЕ: предмет неполон — {subject3}")
        return 1
    if subject3 is not None:
        print(f"НЕ ИЗМЕРЕНО: {subject3} — пустой результат без предмета "
              "нулём не считается")
        return 3
    print(summary_line(stats, 0))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
