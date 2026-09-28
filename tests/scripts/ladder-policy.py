#!/usr/bin/env python3
"""Статический прибор политики лестниц замены модели (failover).

Предмет: таблицы [failover.class.<id>] и ключ [failover].terminal реестра
проб probes.toml против допуска клеток [classes.<id>].allowed и [pins] в
hooks/routing-table.toml. Мод (plugins/catalyst-probes/hooks/register.ts)
переходит только по явной лестнице (agent/class/default), после неё -- на
терминал; допуск клетки ступеней не порождает, и клетка без явной лестницы
получает один терминал. Гейт диспатча срабатывает на вызове инструмента,
тогда как лестница меняет модель уже ПОСЛЕ него и вторым вызовом не
проверяется -- поэтому проверка
обязана быть внешней и статической. Пять правил и разбор элемента
(брифы #225 и #230 -- адъюдикация контроллера 2026-09-16; #261 -- 2026-09-18;
#274/#275 -- 2026-09-19):

  правило-1-допуск: каждая ступень каждой [failover.class.<id>] обязана быть
    в [classes.<id>].allowed СЛИТОГО допуска -- база hooks/routing-table.toml,
    поверх машинный ~/.claude/catalyst/routing-override.toml (только чтение),
    поверх проектный <dir>/.claude/catalyst/routing-override.toml (ближайший
    вверх от cwd или от --project <dir>); запись клетки слоя ЗАМЕНЯЕТ базовую
    целиком -- семантика load_table, hooks/dispatch-gate.py. Класса нет в
    таблице -- нарушение с названной клеткой, не тихий пропуск. Имена
    сравниваются одной нормализацией с модом (norm_model_id: strip, lower,
    снятие суффикса "[1m]").
  правило-2-антропик: ни одна ступень не смеет быть Anthropic-носителем:
    автоматический переход на него обошёл бы маркер [anthropic-exception:…]
    молча. Признак -- по объявленным ниже семействам; имя, не опознанное НИ
    одним семейством, -- нарушение «семейство не определено»: слепота
    прибора обязана быть слышна, иначе новая модель молча выключит правило.
  правило-3-эффорт: объявленный effort ступени обязан быть в [pins] своей
    модели (hooks/routing-table.toml). Нет записи в [pins] -- отдельная
    причина «пин-эффорта-не-объявлен» (пусто ≠ ноль), не молчаливый допуск.
    Ступень без effort правило 3 не задевает.
  правило-4-запас: каждый класс БАЗОВОЙ таблицы с непустым допуском обязан
    нести минимум две модели (после той же нормализации, что у гварда:
    str.lower). Иначе перехода внутри клетки нет: правило-1 требует
    ladder ⊆ слитого allowed, и отказ единственной модели сразу уводит
    клетку на терминал. Класс с пустым допуском правило-4 не задевает: он
    не делегируется, диспатчей у него нет. Сканируются ВСЕ классы базовой
    таблицы, не только те, у кого есть лестница.
  правило-6-терминал: [failover].terminal (присутствует, когда есть секция
    [failover]; проектный реестр перекрывает канон) -- ровно одна модель:
    строка или таблица с model. Имя нормализуется norm_model_id; алиасы
    opus/fable/sonnet/haiku отвергаются (версионно-зависимы); модель --
    Anthropic-носитель с id "claude-…" (признак мода isAnthropicModelId:
    ему пин клетки не нужен, эффорт нативный). Объявленный effort судит
    только словарь эффорта мода (EFFORTS в
    plugins/catalyst-probes/hooks/register.ts, читается из исходника, не
    копируется); запись [pins] терминал не сужает -- мод её не читает. Это ЕДИНСТВЕННОЕ законное место Anthropic-носителя в
    [failover]: мод переходит на терминал, когда все ступени клетки
    исчерпаны (#509, слово юзера 2026-09-25). Вердикт на входах таблицы
    plugins/catalyst-probes/tests/terminal-parity-509.ts совпадает с модом.
  правило-6-канон: принятый правилом-6 терминал записан канонически -- без
    пробелов по краям и без верхнего регистра ("[1m]" в нижнем каноничен);
    правило только прибора (мод такую строку принимает), вне паритета.
  Разбор элемента -- до правил, контракт поведения parseRungItem
    (plugins/catalyst-probes/hooks/register.ts): неразобранная ступень
    (пустая строка, число, объект без model) -- «ступень-не-разобрана»;
    ключ вне {model, effort, max_tokens, timeout_ms, context_chars} --
    «ключ-ступени-неизвестен». Словарь эффорта в этот файл не копируется.

«Запас независимости» критик/аудит-клеток статическим правилом НЕ выражается
(адъюдикация #226: её предмет -- «критик не той же моделью, что исполнитель
этой работы», рантайм-факт) -- прибор его не проверяет и молчать о нём не
обязан.

Коды возврата (контракт агрегатора tests/run-all.sh):
  0 -- правила соблюдены; ОДНА итоговая строка: число лестниц + имя файла;
  1 -- нарушение правила: клетка, ступень и правило названы дословно;
  2 -- ПРИБОР НЕДОСТУПЕН: реестр или таблица не найдены/не разобраны --
       перечислено, что искал и где; молчаливый пропуск невозможен;
  3 -- НЕ ИЗМЕРЕНО: файлы нашлись, но ни одной таблицы [failover.*] не
       разобрано (ПУСТО != НОЛЬ).
"""
import contextlib
import io
import os
import re
import sys
import tempfile

try:
    import tomllib
except ImportError:  # Python < 3.11 -- fail-closed с названной причиной
    tomllib = None

# --- правило-2-антропик: объявленные семейства (дом списка -- этот файл) ---
# Anthropic: точные id -- дословно [quota].guarded_models дома
# hooks/routing-table.toml (ценз 2026-09-16); префикс "claude" -- прочие
# Anthropic-носители сетки несут claude-* (claude-opus-5[1m], claude-fable-*).
# Короткое имя вне списка (новый opus-подобный id) НЕ опознано -- это
# «семейство не определено», прибор краснеет, а не молчит.
ANTHROPIC_EXACT_IDS = (
    "opus", "claude-opus-5[1m]", "claude-opus-5-5", "claude-opus-5-5[1m]", "fable", "fable-5-1",
    "claude-fable-5-1", "claude-fable-5-1[1m]",
)
ANTHROPIC_PREFIXES = ("claude",)
# Вендорские семейства -- префиксы id из допуска сетки
# (hooks/routing-table.toml [classes.*].allowed, ценз 2026-09-16) и флота:
# glm-5.3/5.3-flash, grok-4.6, qwen3.8-flash, gpt-6-astra, gpt-6-sol/luna,
# deepseek-flash/v4-pro, kimi-k3, devin/swe-2 -- там же; MiniMax-M3 --
# tests/scripts/test-dispatch-stats.sh (модель флота).
VENDOR_FAMILY_PREFIXES = (
    "glm-", "grok-", "qwen", "gpt-", "deepseek-", "kimi-", "minimax", "devin/",
)

# --- где брать реестр (порядок фиксирован брифом #225) ---------------------
# 1) env CATALYST_PROBES_REGISTRY -- явный указ оператора. Задан, но файла
#    нет -- громкий отказ (код 2), а не тихое понижение до следующего
#    кандидата: прибор не вправе мерить не тот файл, на который указали.
# 2) соседний канон ../Catalyst-CC-Patch/probes/probes.toml
# 3) боевой ~/.claude/probes/probes.toml
ENV_REGISTRY_VAR = "CATALYST_PROBES_REGISTRY"


def tool_root():
    """Корень репозитория: tests/scripts/ladder-policy.py -> <repo>."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def resolve_registry(root, env=None, home=None):
    """(path, attempts, error): первый СУЩЕСТВУЮЩИЙ кандидат -- предмет.

    attempts -- перечень «метка: путь» в порядке поиска (для отчёта кода 2);
    error не None -- громкая остановка (env указывает мимо; пониать указ
    до следующего кандидата прибор не вправе).
    """
    envd = os.environ if env is None else env
    if home is None:
        home = os.path.expanduser("~")
    attempts = []
    explicit = str(envd.get(ENV_REGISTRY_VAR, "")).strip()
    if explicit:
        attempts.append((f"env {ENV_REGISTRY_VAR}", explicit))
        if not os.path.isfile(explicit):
            return None, attempts, (
                f"env {ENV_REGISTRY_VAR} указывает на отсутствующий файл: {explicit}"
                " (понизить указ до следующего кандидата прибор не вправе)"
            )
        return explicit, attempts, None
    for label, path in (
        ("соседний канон",
         os.path.normpath(os.path.join(root, os.pardir, "Catalyst-CC-Patch",
                                       "probes", "probes.toml"))),
        ("боевой", os.path.join(home, ".claude", "probes", "probes.toml")),
    ):
        attempts.append((label, path))
        if os.path.isfile(path):
            return path, attempts, None
    return None, attempts, None


def load_toml(path):
    """(data, None) или (None, причина_отказа_прибора) -- никогда не бросает."""
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


_ANTHROPIC_LOW = frozenset(a.lower() for a in ANTHROPIC_EXACT_IDS)


def _is_anthropic_name(name):
    """Признак правила-2 для ЛЮБОГО имени модели (не только ступени)."""
    low = str(name).strip().lower()
    return low in _ANTHROPIC_LOW or low.startswith(ANTHROPIC_PREFIXES)


def norm_model_id(name):
    """Нормализация имени модели -- ДОСЛОВНО normModelId мода (register.ts).

    CONSTRAINT (#509-FIX1 E1): один дом правила на обе стороны паритета --
    strip, lower, снятие суффикса окна "[1m]"/"[2m]"; второй вариант развёл
    бы вердикты.
    """
    low = str(name).strip().lower()
    return low[:-4].strip() if re.search(r"\[[12]m\]$", low) else low


# CONSTRAINT (#509-FIX1 E2): алиасы -- ДОСЛОВНО TERMINAL_ALIASES мода.
TERMINAL_ALIASES = ("opus", "fable", "sonnet", "haiku")

MOD_REGISTER_REL = os.path.join("plugins", "catalyst-probes", "hooks", "register.ts")
PARITY_TABLE_REL = os.path.join("plugins", "catalyst-probes", "tests",
                                "terminal-parity-509.ts")


def load_mod_efforts(root=None):
    """(список, None) или (None, причина): словарь EFFORTS из исходника мода.

    CONSTRAINT: словарь в прибор не копируется -- читается строка
    `export const EFFORTS = [...]` дома мода; нет строки -- причина, не
    молчаливый пустой словарь.
    """
    import json
    import re
    path = os.path.join(root or tool_root(), MOD_REGISTER_REL)
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return None, f"словарь эффорта мода не прочитан: {path}: {e}"
    m = re.search(r'^export const EFFORTS = (\[[^\]\n]*\])', text, re.M)
    if not m:
        return None, f"словарь эффорта мода не найден: {path}"
    try:
        vals = json.loads(m.group(1))
    except ValueError as e:
        return None, f"словарь эффорта мода не разобран: {path}: {e}"
    if not isinstance(vals, list) or not vals:
        return None, f"словарь эффорта мода пуст: {path}"
    return [str(v) for v in vals], None


def load_parity_table(root=None):
    """(строки, None) или (None, причина): таблица паритета терминала."""
    import json
    path = os.path.join(root or tool_root(), PARITY_TABLE_REL)
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return None, f"таблица паритета не прочитана: {path}: {e}"
    try:
        a = text.index("// BEGIN-JSON\n") + len("// BEGIN-JSON\n")
        b = text.index("// END-JSON", a)
        rows = json.loads(text[a:b])
    except ValueError as e:
        return None, f"таблица паритета не разобрана: {path}: {e}"
    if not isinstance(rows, list) or not rows:
        return None, f"таблица паритета пуста: {path}"
    return rows, None


def merge_layer(base, over):
    """Слой поверх таблицы -- ДОСЛОВНО load_table (hooks/dispatch-gate.py):
    таблица-значение сливается по ключам, запись слоя заменяет одноимённую
    целиком; прочее заменяется."""
    out = dict(base)
    for k, v in over.items():
        if k == "schema_version":
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            merged = dict(out[k])
            merged.update(v)
            out[k] = merged
        else:
            out[k] = v
    return out


PROJECT_OVERRIDE_REL = os.path.join(".claude", "catalyst", "routing-override.toml")
PROJECT_PROBES_REL = os.path.join(".claude", "probes", "probes.toml")


def find_upward(start, rel, exclude=()):
    """Ближайший <dir>/rel вверх от start, кроме путей exclude, или None."""
    if not start:
        return None
    ex = {os.path.abspath(x) for x in exclude if x}
    d = os.path.abspath(start)
    while True:
        cand = os.path.join(d, rel)
        if os.path.abspath(cand) not in ex and os.path.isfile(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def merge_failover(canon, project):
    """Проектный [failover] поверх канона -- семантика failoverOf мода:
    enabled/terminal проекта перекрывают, default/class/agent сливаются по
    ключам с заменой записи целиком."""
    g = canon if isinstance(canon, dict) else {}
    p = project if isinstance(project, dict) else {}
    out = dict(g)
    for k in ("enabled", "terminal"):
        if k in p:
            out[k] = p[k]
    for k in ("default", "class", "agent"):
        gv, pv = g.get(k), p.get(k)
        if isinstance(pv, dict):
            merged = dict(gv) if isinstance(gv, dict) else {}
            merged.update(pv)
            out[k] = merged
        elif k in p:
            out[k] = pv
    return out

# CONSTRAINT: известные ключи -- поля parseRungItem (register.ts:464-484).
# Любой другой ключ мод молча игнорирует, поэтому опечатка обязана быть
# слышна здесь. Словарь значений эффорта СЮДА не копировать -- только имена
# ключей контракта.
KNOWN_RUNG_KEYS = frozenset(
    ("model", "effort", "max_tokens", "timeout_ms", "context_chars")
)


def parse_rung_item(rung):
    """Разбор элемента лестницы. Контракт -- поведение parseRungItem, не код.

    (parsed, unknown_keys): parsed is {"model": str, "effort"?: str} либо
    None (ступень отброшена). unknown_keys -- ключи вне контракта, только
    у объекта.
    """
    if isinstance(rung, str):
        if rung:
            return {"model": rung}, ()
        return None, ()
    if isinstance(rung, dict):
        unknown = tuple(k for k in rung if k not in KNOWN_RUNG_KEYS)
        model = rung.get("model")
        if not model:
            return None, unknown
        parsed = {"model": str(model)}
        effort = rung.get("effort")
        if effort:
            parsed["effort"] = str(effort)
        return parsed, unknown
    return None, ()


def rung_violation(cell, rung, allowed, pins=None, index=0):
    """Строка-нарушение для одной ступени или None.

    Сначала разбор элемента, потом правила. Порядок после разбора запинен
    зубами: неразобранная -> антропик -> семейство -> допуск -> неизвестный
    ключ -> правило-3-эффорт. На ступень -- первое совпадение. Допуск
    сверяется предикатом ГВАРДА -- str(x).strip().lower() с обеих сторон
    (check_class_admits, hooks/dispatch-gate.py): прибор не имеет права быть
    строже того, что меряет. Суффикс "[1m]" -- часть идентификатора модели,
    нормализация его не трогает. [pins] сверяются ТОЧНО, семейства -- по
    префиксам без регистра.

    CONSTRAINT: запрет носителя идёт ПЕРЕД неизвестным ключом. Порядок несущий:
    на ступени {model = "opus", efort = …} причина «опечатка в ключе» скрыла бы
    запрет носителя до починки опечатки, то есть самое тяжёлое нарушение
    вскрывалось бы вторым заходом. Лишний ключ имя модели не портит, поэтому
    вердикт о носителе на нём достоверен.
    CONSTRAINT: список допущенных effort читается из pins поданной таблицы,
    локальной копии словаря эффорта в приборе нет.
    CONSTRAINT (паритет с модом, замер 16.09): на НЕСТРОКОВОМ effort прибор
    строже мода намеренно. Мод делает String(x.effort), поэтому ["max"]
    склеивается в "max" и ПРИМЕНЯЕТСЯ, а число уходит в effortBad и ступень
    едет без эффорта. Прибор в обоих случаях краснеет: в реестре это опечатка,
    и молчаливое её применение -- ровно тот класс, который правило закрывает.
    """
    if pins is None:
        pins = {}
    parsed, unknown = parse_rung_item(rung)
    if parsed is None:
        return (f"НАРУШЕНИЕ ступень-не-разобрана: клетка {cell}, позиция {index} — "
                "ступень не разобрана")
    name = parsed["model"]
    # CONSTRAINT (паритет с гвардом, #275): имя нормализуется strip().lower()
    # ДО всех правил -- антропик, семейство и допуск обязаны видеть то же
    # имя, что и check_class_admits, иначе " GLM-5.3 " краснел на семействе,
    # которое гвард допускал.
    low = name.strip().lower()
    if low in _ANTHROPIC_LOW or low.startswith(ANTHROPIC_PREFIXES):
        return (f"НАРУШЕНИЕ правило-2-антропик: клетка {cell}, ступень {name} — "
                "Anthropic-носитель в лестнице запрещён: автоматический переход "
                "на него обошёл бы маркер [anthropic-exception:…] молча")
    if not low.startswith(VENDOR_FAMILY_PREFIXES):
        return (f"НАРУШЕНИЕ семейство-не-определено: клетка {cell}, ступень {name} — "
                "семейство не определено: имя не опознано ни одним объявленным "
                "семейством прибора")
    # CONSTRAINT (#509-FIX1 A2/E1): обе стороны сравнения -- norm_model_id,
    # та же функция, что у мода: "Glm-5.3" против allowed ["glm-5.3"] мод
    # пускает, и прибор обязан пускать.
    if norm_model_id(name) not in {norm_model_id(a) for a in allowed}:
        return (f"НАРУШЕНИЕ правило-1-допуск: клетка {cell}, ступень {name} — "
                f"вне допуска клетки: нет в [classes.{cell}].allowed "
                "(слитый допуск: база + машинный + проектный)")
    if unknown:
        return (f"НАРУШЕНИЕ ключ-ступени-неизвестен: клетка {cell}, ключ {unknown[0]}")
    effort = parsed.get("effort")
    if effort:
        pin_list = pins.get(name)
        if name not in pins:
            return (f"НАРУШЕНИЕ пин-эффорта-не-объявлен: клетка {cell}, "
                    f"модель {name} — в [pins] нет записи, эффорт {effort} "
                    "неизмерим")
        if not isinstance(pin_list, list):
            # CONSTRAINT: «записи нет» и «запись не того вида» -- разные
            # починки. Общий текст послал бы оператора заводить пин, который
            # уже заведён, и форма записи осталась бы битой.
            return (f"НАРУШЕНИЕ пин-эффорта-не-список: клетка {cell}, "
                    f"модель {name} — запись в [pins] есть, но она не список "
                    f"({type(pin_list).__name__}); эффорт {effort} неизмерим")
        if effort not in pin_list:
            shown = ", ".join(str(x) for x in pin_list)
            return (f"НАРУШЕНИЕ правило-3-эффорт: клетка {cell}, модель {name}, "
                    f"объявлено {effort}, допущены [{shown}]")
    return None


# CONSTRAINT: Anthropic-носитель в ЛЕСТНИЦЕ запрещён правилом-2, а здесь ОБЯЗАТЕЛЕН: терминал -- единственное законное место (слово юзера 2026-09-25: «если в клетке у всех все закончилось переходил на дефолтовый (у нас сейчас это будет opus 5.5)»); журнал мода метит такой переход cell-exhausted.
# CONSTRAINT: запрет не-Anthropic идёт ПЕРЕД неизвестным ключом -- тот же порядок, что у rung_violation: опечатка в ключе не скрывает неверный носитель.
# CONSTRAINT (#509-FIX1 B2/E3): вердикт на входах таблицы паритета ОБЯЗАН совпадать с модом (failoverTerminal + отказ негодного эффорта); признак носителя -- id "claude-…" после norm_model_id, как isAnthropicModelId мода.
def terminal_violation(failover, pins, efforts=None):
    """(строка-нарушение или None, имя терминала или None) для [failover].terminal.

    efforts -- словарь эффорта мода (load_mod_efforts); None -- словарь не
    загружен, и эффорт без записи в [pins] неизмерим (причина называется).
    """
    if "terminal" not in failover:
        return ("НАРУШЕНИЕ правило-6-терминал: ключ [failover].terminal не "
                "объявлен — клетка, исчерпавшая лестницу, останется без "
                "дефолта"), None
    raw = failover["terminal"]
    if isinstance(raw, str) and not raw.strip():
        return "НАРУШЕНИЕ правило-6-терминал: ключ [failover].terminal пуст", None
    if isinstance(raw, list):
        return ("НАРУШЕНИЕ правило-6-терминал: [failover].terminal — список; "
                "допустима ровно одна модель (строка или таблица с model)"), None
    if not isinstance(raw, (str, dict)):
        return ("НАРУШЕНИЕ правило-6-терминал: форма [failover].terminal "
                f"негодна ({type(raw).__name__})"), None
    parsed, unknown = parse_rung_item(raw)
    if parsed is None or not norm_model_id(parsed["model"]):
        return ("НАРУШЕНИЕ правило-6-терминал: таблица [failover].terminal "
                "без model"), None
    name = norm_model_id(parsed["model"])
    if name in TERMINAL_ALIASES:
        return ("НАРУШЕНИЕ правило-6-терминал: терминал "
                f"{name} — алиас отвергнут (версионно-зависим); нужен полный "
                "id claude-…"), None
    if not name.startswith("claude-"):
        return ("НАРУШЕНИЕ правило-6-терминал: терминал "
                f"{name} — не Anthropic-носитель; дефолт исчерпанной клетки — "
                "claude-opus-5-5 (слово юзера 2026-09-25)"), None
    if unknown:
        return ("НАРУШЕНИЕ ключ-терминала-неизвестен: [failover].terminal, "
                f"ключ {unknown[0]}"), None
    effort = parsed.get("effort")
    # CONSTRAINT (#509-FIX1 B1/B2): терминал claude-… освобождён от [pins];
    # его эффорт судит только словарь мода -- та же граница, что effortBad
    # мода, иначе вердикты мода и прибора на одном входе разошлись бы.
    if effort:
        if efforts is None:
            return ("НАРУШЕНИЕ правило-6-терминал: эффорт терминала "
                    f"{name} {effort} неизмерим — словарь эффорта мода не "
                    "загружен"), None
        elif effort not in efforts:
            shown = ", ".join(efforts)
            return ("НАРУШЕНИЕ правило-6-терминал: эффорт терминала "
                    f"{name} {effort} негоден — словарь мода [{shown}]"), None
    return None, name


# CONSTRAINT (#509-FIX4 (б), #509-FIX5 Р6): канон пишет терминал в канонической
# форме -- без пробельных символов где угодно и без верхнего регистра (суффикс
# "[1m]" в нижнем регистре каноничен). Правило только прибора и вне
# terminal_violation: мод такую строку принимает и шлёт как написана
# (register.ts failoverTerminal), а вердикт terminal_violation на таблице
# паритета обязан совпадать с модом.
def terminal_form_violation(failover):
    raw = failover.get("terminal")
    model = raw.get("model") if isinstance(raw, dict) else raw
    if not isinstance(model, str):
        return None
    if re.search(r"\s", model) or model != model.lower():
        return ("НАРУШЕНИЕ правило-6-канон: [failover].terminal = "
                f"{model!r} — неканоничная форма (пробельные символы или "
                "верхний регистр); канон пишет id без пробелов в нижнем регистре")
    return None


def verdict_line(registry_path, ladders, rungs, effort_rungs, classes_checked,
                 terminal=None, layers="база"):
    """Итоговая строка зелёного исхода. Один дом текста вердикта.

    CONSTRAINT: при НУЛЕ ступеней с объявленным эффортом правило-3 назвать
    соблюдённым нельзя -- у него пустой знаменатель, а пусто != ноль (тот же
    закон, по которому реестр без [failover.*] даёт НЕ ИЗМЕРЕНО, а не
    зелёное). Знаменатели каждого правила печатаются числом рядом, иначе
    читатель принимает молчание прибора за проверенность.
    CONSTRAINT: правило-6 печатается только когда прибор разобрал терминал (terminal is not None); реестр без [failover] терминала не несёт, и молчание здесь -- неизмеренность, не проверенность.
    CONSTRAINT (#509-FIX1 K): вердикт называет СЛИТЫЙ допуск и его слои --
    правило-1 сверялось с ним, а не с базой.
    """
    head = (f"лестниц {ladders} (ступеней {rungs}, с эффортом {effort_rungs}), "
            f"файл {registry_path}: ")
    adm = f"слитый допуск: {layers}"
    rule4 = f"правило-4-запас — на всех {classes_checked} классах таблицы"
    if terminal is not None:
        rule4 += f"; правило-6-терминал — {terminal}"
    if effort_rungs == 0:
        return (head + f"правило-1-допуск ({adm}) и "
                f"правило-2-антропик соблюдены на всех {rungs} ступенях; "
                f"правило-3-эффорт НЕ ИЗМЕРЕНО — ступеней с объявленным "
                f"эффортом 0; {rule4}")
    return (head + f"правило-1-допуск ({adm}) и "
            f"правило-2-антропик соблюдены на всех {rungs} ступенях, "
            f"правило-3-эффорт — на всех {effort_rungs} с объявленным "
            f"эффортом, {rule4}")


def load_layers(table_path, machine_path=None, project_override=None):
    """(таблица, слои, None) или (None, None, причина): база + слои допуска.

    CONSTRAINT: машинный слой читается ТОЛЬКО на чтение; отсутствующий слой
    пропускается, нечитаемый -- отказ прибора (тот же громкий отказ, что у
    гварда: тихий откат к базе и есть дефект #274).
    """
    tab, err = load_toml(table_path)
    if err is not None:
        return None, None, f"таблица маршрутизации: {err}"
    names = ["база"]
    seen = set()
    for label, path in (("машинный", machine_path), ("проектный", project_override)):
        if not path or not os.path.isfile(path):
            continue
        if os.path.abspath(path) in seen:
            continue
        seen.add(os.path.abspath(path))
        over, err = load_toml(path)
        if err is not None:
            return None, None, f"слой допуска {label}: {err}"
        tab = merge_layer(tab, over)
        names.append(label)
    return tab, "+".join(names), None


def check_ladders(registry_path, table_path, machine_path=None,
                  project_override=None, project_registry=None, efforts=None):
    """(reason, violations, ladders, rungs, effort_rungs, classes_checked,
    terminal).

    reason None -- предмет измерим: violations -- список строк-нарушений
    (пустой = правила соблюдены), ladders -- число разобранных таблиц
    [failover.class.*], rungs -- число ступеней в них, effort_rungs --
    сколько из них с объявленным effort, classes_checked -- сколько
    классов базовой таблицы просмотрело правило-4-запас, terminal -- имя
    терминальной модели, если правило-6 его разобрало, иначе None. reason
    не None -- прибор не в состоянии мерить (код 2). Слои допуска
    (machine_path, project_override) и проектный реестр (project_registry)
    сливаются поверх базы и канона до правил (#509-FIX1 A4, F).
    """
    _ua = (None, None, None, None, None, None)

    def unavail(msg):
        return (msg,) + _ua

    reg, err = load_toml(registry_path)
    if err is not None:
        return unavail(f"реестр: {err}")
    base_tab, err = load_toml(table_path)
    if err is not None:
        return unavail(f"таблица маршрутизации: {err}")
    tab, _layers, err = load_layers(table_path, machine_path, project_override)
    if err is not None:
        return unavail(err)

    failover = reg.get("failover")
    if project_registry and os.path.isfile(project_registry):
        preg, err = load_toml(project_registry)
        if err is not None:
            return unavail(f"проектный реестр: {err}")
        pf = preg.get("failover")
        if pf is not None:
            if not isinstance(pf, dict):
                return unavail(f"проектный реестр {project_registry}: секция "
                               "[failover] не таблица -- форма лестниц не разобрана")
            if failover is not None and not isinstance(failover, dict):
                return unavail(f"реестр {registry_path}: секция [failover] не "
                               "таблица -- форма лестниц не разобрана")
            failover = merge_failover(failover, pf)
    if failover is None:
        classes_map = {}
    elif not isinstance(failover, dict):
        return unavail(f"реестр {registry_path}: секция [failover] не таблица -- "
                       "форма лестниц не разобрана")
    else:
        classes_map = failover.get("class")
        if classes_map is None:
            classes_map = {}
        elif not isinstance(classes_map, dict):
            return unavail(
                f"реестр {registry_path}: секция [failover.class] не таблица -- "
                "форма лестниц не разобрана")
    grid = tab.get("classes", {})
    if not isinstance(grid, dict):
        return unavail(f"таблица {table_path}: секция [classes] не таблица -- "
                       "допуск клеток не разобран")
    pins = tab.get("pins", {})
    if not isinstance(pins, dict):
        return unavail(f"таблица {table_path}: секция [pins] не таблица -- "
                       "допуск эффорта не разобран")

    violations = []
    ladders = 0
    rungs = 0
    effort_rungs = 0
    for cell in classes_map:
        ladder = classes_map[cell]
        if not isinstance(ladder, dict):
            return unavail(
                f"реестр {registry_path}: [failover.class.{cell}] не таблица -- "
                "форма лестницы не разобрана")
        ladders += 1
        models = ladder.get("models", [])
        if not isinstance(models, list):
            return unavail(
                f"реестр {registry_path}: [failover.class.{cell}].models не список -- "
                "форма лестницы не разобрана")
        entry = grid.get(cell)
        if not isinstance(entry, dict):
            violations.append(
                f"НАРУШЕНИЕ правило-1-допуск: клетка {cell} — класса нет в "
                f"routing-table.toml: секции [classes.{cell}] нет"
            )
            continue
        allowed = entry.get("allowed", [])
        if not isinstance(allowed, list):
            return unavail(
                f"таблица {table_path}: [classes.{cell}].allowed не список -- "
                "допуск клетки не разобран")
        for index, rung in enumerate(models):
            rungs += 1
            parsed, _unknown = parse_rung_item(rung)
            if parsed is not None and parsed.get("effort"):
                effort_rungs += 1
            v = rung_violation(cell, rung, allowed, pins=pins, index=index)
            if v is not None:
                violations.append(v)

    base_grid = base_tab.get("classes", {})
    if not isinstance(base_grid, dict):
        return unavail(f"таблица {table_path}: секция [classes] не таблица -- "
                       "допуск клеток не разобран")
    classes_checked = 0
    for cell, entry in base_grid.items():
        classes_checked += 1
        if not isinstance(entry, dict):
            return unavail(
                f"таблица {table_path}: [classes.{cell}] не таблица -- "
                "допуск клетки не разобран")
        allowed = entry.get("allowed", [])
        if not isinstance(allowed, list):
            return unavail(
                f"таблица {table_path}: [classes.{cell}].allowed не список -- "
                "допуск клетки не разобран")
        if not allowed:
            continue
        unique = {str(a).lower() for a in allowed}
        if len(unique) < 2:
            shown = str(allowed[0]) if allowed else ""
            violations.append(
                f"НАРУШЕНИЕ правило-4-запас: клетка {cell} — допуск состоит из одной модели {shown}, "
                f"запасного пути нет ни из одного источника"
            )

    terminal = None
    if isinstance(failover, dict):
        v, terminal = terminal_violation(failover, pins, efforts)
        if v is None and terminal is not None:
            v = terminal_form_violation(failover)
            if v is not None:
                terminal = None
        if v is not None:
            violations.append(v)
    return (None, violations, ladders, rungs, effort_rungs, classes_checked,
            terminal)


class ToothBook:
    """Книга зубов самопроверки: вызовы предмета под обёрткой и их зубы.

    CONSTRAINT (#509-FIX2c): вызов предмета в самопроверке не роняет её
    целиком -- бросок запоминается, вызывающему уходит безвредная заглушка
    формы результата, и итог считает все зубы.
    """

    def __init__(self):
        self.teeth = []
        self.calls = []

    def guarded(self, fn, dummy):
        name = getattr(fn, "__name__", "?")

        def call(*a, **k):
            try:
                r = fn(*a, **k)
            except Exception as x:
                self.calls.append((name, x))
                return dummy
            self.calls.append((name, None))
            return r
        return call

    def tooth(self, name, ok, detail="", calls=1):
        # CONSTRAINT (#509-FIX3 L6): зуб объявляет число СВОИХ вызовов предмета;
        # лишний или недостающий вызов -- красный зуб, а не бросок чужого
        # вызова, приписанный соседу.
        got, self.calls = self.calls, []
        thrown = [x for _, x in got if x is not None]
        if thrown:
            self.teeth.append((name, False, "; ".join(
                f"бросок {type(x).__name__}: {x}" for x in thrown)))
            return
        if len(got) != calls:
            self.teeth.append((name, False, f"привязка: вызовов предмета {len(got)} "
                               f"({', '.join(n for n, _ in got)}), зуб объявил {calls}"))
            return
        self.teeth.append((name, bool(ok), detail))

    def close(self):
        # CONSTRAINT (#509-FIX3 L6): вызов после последнего зуба входит в итог
        # красным -- иначе его бросок терялся бы вне счёта.
        if self.calls:
            got, self.calls = self.calls, []
            thrown = [x for _, x in got if x is not None]
            detail = "; ".join(f"бросок {type(x).__name__}: {x}" for x in thrown) or \
                "без броска"
            self.teeth.append(("вызовы предмета после последнего зуба", False,
                               f"вызовов {len(got)} ({', '.join(n for n, _ in got)}): {detail}"))
        return self.teeth


def self_check():
    """Зубы прибора на синтетических входах, офлайн. 0 -- все зелёны."""
    book = ToothBook()
    teeth = book.teeth
    tooth = book.tooth
    guarded = book.guarded

    resolve_registry_s = guarded(resolve_registry, (None, [], None))
    verdict_line_s = guarded(verdict_line, "")
    terminal_violation_s = guarded(terminal_violation, (None, None))
    load_parity_table_s = guarded(load_parity_table, (None, None))
    load_mod_efforts_s = guarded(load_mod_efforts, (None, None))

    def guard_probe():
        raise ValueError("зонд самопроверки")

    def bind_probe():
        return 1

    guard_detail = ""
    guard_ok = False
    try:
        probe_book = ToothBook()
        probe_book.guarded(guard_probe, None)()
        probe_book.tooth("зонд-приёмник", True)
        got = probe_book.teeth[-1]
        guard_ok = (got[1] is False and "ValueError" in got[2]
                    and "зонд самопроверки" in got[2] and not probe_book.calls)
        guard_detail = f"приёмник={got!r}"
    except Exception as x:
        guard_detail = f"обёртка пропустила бросок {type(x).__name__}: {x}"
    tooth("обёртка самопроверки: бросок предмета -- красный зуб с именем ошибки, прогон продолжается",
          guard_ok, guard_detail, calls=0)

    # L6 (#509-FIX3): вызов предмета привязан к СВОЕМУ зубу -- зуб объявляет
    # число своих вызовов, лишний или недостающий вызов красит его.
    bind_detail = ""
    bind_ok = False
    try:
        b = ToothBook()
        f = b.guarded(bind_probe, None)
        f()
        b.tooth("один вызов -- один зуб", True, calls=1)
        f()
        f()
        b.tooth("два вызова при объявленном одном", True, calls=1)
        b.tooth("ноль вызовов при объявленном одном", True, calls=1)
        got = b.close()
        bind_ok = (len(got) == 3 and got[0][1] is True
                   and got[1][1] is False and "привязка" in got[1][2]
                   and got[2][1] is False and "привязка" in got[2][2])
        bind_detail = f"книга={got!r}"
    except Exception as x:
        bind_detail = f"бросок {type(x).__name__}: {x}"
    tooth("L6: вызов предмета привязан к своему зубу -- лишний и недостающий вызов красят зуб",
          bind_ok, bind_detail, calls=0)
    tail_detail = ""
    tail_ok = False
    try:
        b = ToothBook()
        b.tooth("последний зуб", True, calls=0)
        b.guarded(guard_probe, None)()
        got = b.close()
        tail_ok = (len(got) == 2 and got[1][1] is False
                   and "ValueError" in got[1][2] and "зонд самопроверки" in got[1][2])
        tail_detail = f"книга={got!r}"
    except Exception as x:
        tail_detail = f"бросок {type(x).__name__}: {x}"
    tooth("L6: бросок после последнего зуба входит в итог красным",
          tail_ok, tail_detail, calls=0)

    with tempfile.TemporaryDirectory(prefix="ladder-policy-selfcheck-") as work:
        def reg(text):
            p = os.path.join(work, f"reg-{len(teeth)}-{abs(hash(text)) % 9999}.toml")
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            return p

        table_valid = os.path.join(work, "table.toml")
        with open(table_valid, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "t"\n'
                    'allowed = ["glm-5.3", "grok-4.6"]\n'
                    '[pins]\n'
                    '"glm-5.3" = ["max"]\n'
                    '"grok-4.6" = ["medium", "max"]\n')
        mod_efforts, _mod_eff_err = load_mod_efforts_s()
        tooth("словарь эффортов мода загружен для зубов лестниц",
              mod_efforts is not None and _mod_eff_err is None,
              f"err={_mod_eff_err}")

        def table_with(text):
            p = os.path.join(work, f"tab-{len(teeth)}-{abs(hash(text)) % 9999}.toml")
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            return p

        def check_raw(registry_text=None, registry_path=None, table_path=None,
                      terminal=True, machine_path=None, efforts="mod"):
            if (terminal and registry_text is not None
                    and "[failover" in registry_text):
                if "[failover]\n" in registry_text:
                    registry_text = registry_text.replace(
                        "[failover]\n",
                        '[failover]\nterminal = "claude-opus-5-5"\n', 1)
                else:
                    registry_text = ('[failover]\nterminal = "claude-opus-5-5"\n'
                                     + registry_text)
            r = registry_path or reg(registry_text)
            t = table_path or table_valid
            return check_ladders(r, t, machine_path=machine_path,
                                 efforts=mod_efforts if efforts == "mod" else efforts)

        check = guarded(check_raw, (None, [], 0, 0, 0, 0, None))

        # зуб 0 (положительный контроль): валидная лестница -- 0 нарушений
        reason, vs, l, r, *_ = check(
            '[failover]\nenabled = true\n\n[failover.class.exec-0n]\n'
            'models = ["glm-5.3", "grok-4.6"]\n')
        tooth("положительный контроль: валидная лестница зелена",
              reason is None and not vs and l == 1 and r == 2,
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        # зуб 1: ступень вне допуска клетки -> нарушение правило-1-допуск,
        # названы клетка и ступень
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "glm-5.3-flash"]\n')
        v1 = " ".join(vs)
        tooth("ступень вне допуска -> правило-1-допуск с клеткой и ступенью",
              reason is None and vs
              and any("правило-1-допуск" in x for x in vs)
              and "exec-0n" in v1 and "glm-5.3-flash" in v1,
              f"reason={reason} violations={vs}")

        # зуб 2: Anthropic-имя в лестнице -> правило-2-антропик
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "opus"]\n')
        v2 = " ".join(vs)
        tooth("Anthropic-имя -> правило-2-антропик",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "opus" in v2,
              f"reason={reason} violations={vs}")

        # зуб 3: имя, не опознанное ни одним семейством -> «семейство не
        # определено» (слепота прибора обязана быть слышна)
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "madeup-9"]\n')
        v3 = " ".join(vs)
        tooth("неизвестное имя -> «семейство не определено»",
              reason is None and vs
              and any("семейство не определено" in x for x in vs)
              and "madeup-9" in v3,
              f"reason={reason} violations={vs}")

        # зуб 4: реестр без единой таблицы [failover.*] -> НОЛЬ лестниц
        # (это НЕ ИЗМЕРЕНО, код 3, а не зелёный)
        reason, vs, l, *_ = check('[probe.x]\ny = 1\n')
        tooth("реестр без [failover.*] -> ноль лестниц (НЕ ИЗМЕРЕНО)",
              reason is None and not vs and l == 0,
              f"reason={reason} violations={vs} ladders={l}")

        # зуб 5: отсутствующий реестр -> отказ прибора (код 2) с перечнем
        # искомого: явный указ env мимо, все кандидаты мимо, явный путь назван
        fake_root = os.path.join(work, "no-such-root", "deep")
        fake_home = os.path.join(work, "no-such-home")
        fake_explicit = os.path.join(work, "no-such-explicit.toml")
        p, att, err = resolve_registry_s(fake_root, env={ENV_REGISTRY_VAR: fake_explicit},
                                       home=fake_home)
        tooth("env указывает мимо -> громкий отказ с путём",
              p is None and err is not None and fake_explicit in err,
              f"path={p} err={err}")
        p, att, err = resolve_registry_s(fake_root, env={}, home=fake_home)
        tooth("все кандидаты мимо -> None + перечень искомого",
              p is None and err is None and len(att) == 2
              and all("no-such" in path for _, path in att),
              f"path={p} err={err} attempts={att}")
        fake_reg = os.path.join(work, "no-such-registry.toml")
        reason, vs, *_ = check(registry_path=fake_reg)
        tooth("явный путь отсутствующего реестра -> отказ с названным путём",
              reason is not None and fake_reg in reason and vs is None,
              f"reason={reason}")

        # новые зубы 1–8: богатая форма ступени (бриф #230). Нумерация в именах
        # — нумерация брифа, не индекс печати (существующие 8 зубов впереди).
        reason, vs, l, r, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3", effort = "max"}, "grok-4.6"]\n')
        tooth("богатая форма: допуск + эффорт в pins -> нет нарушений",
              reason is None and not vs and l == 1 and r == 2,
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "opus", effort = "high"}]\n')
        v_rich_anth = " ".join(vs or [])
        tooth("богатая форма: Anthropic -> правило-2-антропик",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "opus" in v_rich_anth
              and not any("семейство-не-определено" in x for x in vs),
              f"reason={reason} violations={vs}")

        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3-flash", effort = "max"}]\n')
        v_rich_allow = " ".join(vs or [])
        tooth("богатая форма: вне допуска -> правило-1-допуск",
              reason is None and vs
              and any("правило-1-допуск" in x for x in vs)
              and "glm-5.3-flash" in v_rich_allow
              and not any("семейство-не-определено" in x for x in vs),
              f"reason={reason} violations={vs}")

        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "grok-4.6", effort = "high"}]\n')
        v_rich_eff = " ".join(vs or [])
        tooth("богатая форма: эффорт вне pins -> правило-3-эффорт со списком",
              reason is None and vs
              and any("правило-3-эффорт" in x for x in vs)
              and "grok-4.6" in v_rich_eff and "high" in v_rich_eff
              and "medium" in v_rich_eff and "max" in v_rich_eff,
              f"reason={reason} violations={vs}")

        reason, vs, l, r, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3"}, "grok-4.6"]\n')
        tooth("богатая форма без effort -> правило 3 молчит",
              reason is None and not vs and l == 1 and r == 2
              and not any("правило-3-эффорт" in x for x in (vs or []))
              and not any("пин-эффорта-не-объявлен" in x for x in (vs or [])),
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        table_nopin = table_with(
            '[classes.exec-0n]\nlabel = "t"\n'
            'allowed = ["glm-5.3", "grok-4.6", "qwen3.8-flash"]\n'
            '[pins]\n'
            '"glm-5.3" = ["max"]\n'
            '"grok-4.6" = ["medium", "max"]\n')
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "qwen3.8-flash", effort = "high"}]\n',
            table_path=table_nopin)
        v_nopin = " ".join(vs or [])
        tooth("модель без pins + effort -> пин-эффорта-не-объявлен",
              reason is None and vs
              and any("пин-эффорта-не-объявлен" in x for x in vs)
              and "qwen3.8-flash" in v_nopin,
              f"reason={reason} violations={vs}")

        cases7 = []
        for text7 in (
            '[failover.class.exec-0n]\nmodels = [""]\n',
            '[failover.class.exec-0n]\nmodels = [42]\n',
            '[failover.class.exec-0n]\nmodels = [{effort = "max"}]\n',
        ):
            reason, vs, *_ = check(text7)
            cases7.append((reason, vs))
        tooth("пустая/число/без model -> ступень-не-разобрана (не семейство)",
              all(
                  reason is None and vs
                  and any("ступень-не-разобрана" in x for x in vs)
                  and not any("семейство-не-определено" in x for x in vs)
                  and not any("семейство не определено" in x for x in vs)
                  for reason, vs in cases7
              ),
              f"cases={cases7}", calls=3)

        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3", efort = "max"}]\n')
        v_unk = " ".join(vs or [])
        tooth("неизвестный ключ ступени -> ключ-ступени-неизвестен",
              reason is None and vs
              and any("ключ-ступени-неизвестен" in x for x in vs)
              and "efort" in v_unk,
              f"reason={reason} violations={vs}")

        # зуб 17 (находка критика F1): счётчик ступеней с эффортом обязан
        # стеречься СВОИМ зубом. Зубы вердикта зовут verdict_line литералами и
        # счётчик не задевают -- выключенный счётчик печатал бы ложное
        # «НЕ ИЗМЕРЕНО» при коде 0, и после заполнения реестра это была бы
        # молчаливая неправда.
        reason, vs, l, r, er, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = ["grok-4.6", {model = "glm-5.3", effort = "max"}]\n')
        tooth("счётчик ступеней с эффортом считает богатую ступень",
              reason is None and not vs and l == 1 and r == 2 and er == 1,
              f"reason={reason} violations={vs} ladders={l} rungs={r} с_эффортом={er}")

        # зуб 18 (находка критика F2): порядок «антропик раньше ключа» несущий
        # и обязан быть запинен, а не только объявлен в докстринге.
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "opus", efort = "max"}]\n')
        v_ord = " ".join(vs or [])
        tooth("Anthropic + опечатка в ключе -> вскрывается ЗАПРЕТ, не ключ",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "ключ-ступени-неизвестен" not in v_ord,
              f"reason={reason} violations={vs}")

        # зуб 19 (находка критика F3): «записи нет» и «запись не список» --
        # разные починки, общий текст уводит оператора не туда.
        table_badpin = table_with(
            '[classes.exec-0n]\nlabel = "t"\n'
            'allowed = ["glm-5.3", "grok-4.6"]\n'
            '[pins]\n'
            '"glm-5.3" = "max"\n')
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3", effort = "max"}]\n',
            table_path=table_badpin)
        v_badpin = " ".join(vs or [])
        tooth("запись в [pins] не список -> своя причина, не «записи нет»",
              reason is None and vs
              and any("пин-эффорта-не-список" in x for x in vs)
              and "пин-эффорта-не-объявлен" not in v_badpin,
              f"reason={reason} violations={vs}")

        # зубы 20-21 (адъюдикация контроллера #230): вердикт не смеет
        # объявлять правило-3 соблюдённым при пустом знаменателе.
        vl0 = verdict_line_s("/р.toml", 20, 77, 0, 4)
        tooth("вердикт при нуле ступеней с эффортом -> правило-3 НЕ ИЗМЕРЕНО",
              "правило-3-эффорт НЕ ИЗМЕРЕНО" in vl0
              and "правило-3-эффорт — на всех" not in vl0
              and "77" in vl0
              and "правило-4-запас — на всех 4 классах таблицы" in vl0,
              f"строка={vl0!r}")
        vl1 = verdict_line_s("/р.toml", 20, 77, 5, 4)
        tooth("вердикт при ненуле -> правило-3 названо со своим знаменателем",
              "правило-3-эффорт — на всех 5" in vl1
              and "НЕ ИЗМЕРЕНО" not in vl1
              and "правило-4-запас — на всех 4 классах таблицы" in vl1,
              f"строка={vl1!r}")

        # правило-4-запас: по ВСЕМ классам таблицы, не только по тем, у кого лестница.
        t4_solo = table_with(
            '[classes.solo]\nlabel = "s"\nallowed = ["glm-5.3"]\n'
            '[pins]\n"glm-5.3" = ["max"]\n')
        reason, vs, *_ = check(
            '[failover.class.solo]\nmodels = ["glm-5.3"]\n',
            table_path=t4_solo)
        tooth("класс с одной моделью -> правило-4-запас",
              reason is None and vs is not None
              and any("правило-4-запас" in x and "solo" in x and "glm-5.3" in x
                      for x in vs),
              f"reason={reason} violations={vs}")

        t4_pair = table_with(
            '[classes.pair]\nlabel = "p"\nallowed = ["glm-5.3", "grok-4.6"]\n'
            '[pins]\n"glm-5.3" = ["max"]\n')
        reason, vs, *_ = check(
            '[failover.class.pair]\nmodels = ["glm-5.3"]\n',
            table_path=t4_pair)
        tooth("класс с двумя моделями -> правило-4 молчит",
              reason is None and not any("правило-4-запас" in x for x in (vs or [])),
              f"reason={reason} violations={vs}")

        t4_empty = table_with(
            '[classes.none]\nlabel = "n"\nallowed = []\nreason = "x"\n'
            '[classes.pair]\nlabel = "p"\nallowed = ["glm-5.3", "grok-4.6"]\n')
        reason, vs, *_ = check(
            '[failover.class.pair]\nmodels = ["glm-5.3"]\n',
            table_path=t4_empty)
        tooth("класс с пустым допуском -> правило-4 молчит",
              reason is None and not any("правило-4-запас" in x for x in (vs or [])),
              f"reason={reason} violations={vs}")

        # правило-4 обязано видеть клетку БЕЗ лестницы: иначе оно снова
        # смотрит только тех, у кого лестница уже есть.
        t4_noline = table_with(
            '[classes.solo]\nlabel = "s"\nallowed = ["glm-5.3"]\n'
            '[classes.pair]\nlabel = "p"\nallowed = ["glm-5.3", "grok-4.6"]\n')
        reason, vs, l, *_ = check('[probe.x]\ny = 1\n', table_path=t4_noline)
        tooth("клетка без лестницы с одной моделью -> правило-4-запас",
              reason is None and l == 0 and vs is not None
              and any("правило-4-запас" in x and "solo" in x and "glm-5.3" in x
                      for x in vs)
              and not any("pair" in x and "правило-4-запас" in x for x in vs),
              f"reason={reason} ladders={l} violations={vs}")

        main_root = os.path.join(work, "main-root")
        main_home = os.path.join(work, "main-home")
        main_table = os.path.join(main_root, "hooks", "routing-table.toml")

        # --- правило-6-терминал: прямые зубы (#509) ---------------------------
        t6 = '[failover.class.exec-0n]\nmodels = ["glm-5.3", "grok-4.6"]\n'
        with open(table_valid, encoding="utf-8") as src:
            table_valid_text = src.read()
        t6_pins_x = table_with(table_valid_text + '"claude-opus-5-5" = ["xhigh"]\n')
        t6_pins_h = table_with(table_valid_text + '"claude-opus-5-5" = ["high"]\n')

        def tooth6(name, head, needles, absent=(), table_path=None):
            reason, vs, _l, _r, _er, _cc, term = check(
                "[failover]\n" + head + t6, table_path=table_path,
                terminal=False)
            joined = " ".join(vs or [])
            tooth(name,
                  reason is None and vs is not None and len(vs) == 1
                  and all(n in joined for n in needles)
                  and not any(a in joined for a in absent)
                  and term is None,
                  f"reason={reason} violations={vs} terminal={term!r}")

        tooth6("правило-6: ключ не объявлен -- красен", "enabled = true\n",
               ("правило-6-терминал", "не объявлен"))
        tooth6("правило-6: пустая строка и пробелы -- красен",
               'terminal = "  "\n', ("пуст",))
        tooth6("правило-6: список -- красен",
               'terminal = ["claude-opus-5-5"]\n', ("список",))
        tooth6("правило-6: число -- форма негодна", "terminal = 42\n",
               ("негодна (int)",))
        tooth6("правило-6: таблица без model -- красен",
               'terminal = {effort = "high"}\n', ("без model",))
        tooth6("правило-6: вендорский носитель -- красен",
               'terminal = "glm-5.3"\n', ("glm-5.3", "не Anthropic"))
        tooth6("правило-6: носитель перед опечаткой ключа",
               'terminal = {model = "glm-5.3", efort = "high"}\n',
               ("не Anthropic",), absent=("ключ-терминала-неизвестен",))
        tooth6("правило-6: опечатка ключа -- красен",
               'terminal = {model = "claude-opus-5-5", efort = "high"}\n',
               ("ключ-терминала-неизвестен", "efort"))
        # B2: эффорт claude-терминала судит словарь мода, не [pins].
        tooth6("B2: негодный эффорт терминала -- красен",
               'terminal = {model = "claude-opus-5-5", effort = "bogus"}\n',
               ("правило-6-терминал", "bogus", "негоден"))
        tooth6("B2: регистр эффорта не нормализуется -- красен (паритет мода)",
               'terminal = {model = "claude-opus-5-5", effort = "High"}\n',
               ("правило-6-терминал", "High", "негоден"))
        reason, vs, _l, _r, _er, _cc, term = check(
            '[failover]\nterminal = {model = "claude-opus-5-5", effort = "high"}\n'
            + t6, terminal=False, efforts=None)
        tooth("B2: словарь мода не загружен -- эффорт неизмерим, красен",
              reason is None and vs is not None and len(vs) == 1
              and "неизмерим" in vs[0] and term is None,
              f"reason={reason} violations={vs} terminal={term!r}")

        reason, vs, _l, _r, _er, _cc, term = check(
            '[failover]\nterminal = {model = "claude-opus-5-5", effort = "xhigh"}\n'
            + t6, terminal=False)
        tooth("B2: годный эффорт без записи в [pins] -- зелёно",
              reason is None and not vs and term == "claude-opus-5-5",
              f"reason={reason} violations={vs} terminal={term!r}")
        reason, vs, _l, _r, _er, _cc, term = check(
            '[failover]\nterminal = {model = "claude-opus-5-5", effort = "high"}\n'
            + t6, table_path=t6_pins_x, terminal=False)
        tooth("B1: запись [pins] терминал не сужает -- зелёно",
              reason is None and not vs and term == "claude-opus-5-5",
              f"reason={reason} violations={vs} terminal={term!r}")
        reason, vs, _l, _r, _er, _cc, term = check(
            '[failover]\nterminal = {model = "claude-opus-5-5", effort = "high"}\n'
            + t6, table_path=t6_pins_h, terminal=False)
        tooth("правило-6: таблица с эффортом в pins -- зелёно",
              reason is None and not vs and term == "claude-opus-5-5",
              f"reason={reason} violations={vs} terminal={term!r}")

        # E1: одна нормализация (trim, lower, снятие [1m]); имя -- нормализованное.
        # Предмет -- terminal_violation (паритет мода); неканоничную форму в
        # каноне красит правило-6-канон (зубы FIX4-(б) ниже).
        v_e1, term = terminal_violation_s({"terminal": " Claude-Opus-5-5[1M] "}, {}, mod_efforts)
        tooth("E1: строка-носитель нормализуется, имя в кортеже нормализовано",
              v_e1 is None and term == "claude-opus-5-5",
              f"violation={v_e1!r} terminal={term!r}")
        # FIX4-(б): форма канона -- без пробелов по краям, нижний регистр.
        tooth6("FIX4-(б): терминал с пробелами по краям -- красен, ключ и значение названы",
               'terminal = " claude-opus-5-5 "\n',
               ("правило-6-канон", "[failover].terminal", "' claude-opus-5-5 '"),
               absent=("правило-6-терминал",))
        reason, vs, _l, _r, _er, _cc, term = check(
            '[failover]\nterminal = "claude-opus-5-5[1m]"\n' + t6, terminal=False)
        tooth("FIX4-(б): суффикс [1m] в нижнем регистре каноничен -- зелёно",
              reason is None and not vs and term == "claude-opus-5-5",
              f"reason={reason} violations={vs} terminal={term!r}")
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = [" GLM-5.3 ", "grok-4.6[1m]"]\n')
        tooth("E1: ступени сверяются с допуском через ту же нормализацию",
              reason is None and not vs,
              f"reason={reason} violations={vs}")
        # E2: алиасы отвергаются, в т.ч. после нормализации.
        for alias in ("opus", " Sonnet ", "fable", "HAIKU"):
            tooth6(f"E2: алиас терминала {alias.strip()} -- красен",
                   f'terminal = "{alias}"\n',
                   ("правило-6-терминал", "алиас"))
        # E3: таблица паритета мода -- тот же вердикт у прибора.
        parity, parity_err = load_parity_table_s()
        mism = []
        for row in parity or []:
            fo = {} if row.get("absent") else {"terminal": row.get("raw")}
            v_p, _n = terminal_violation_s(fo, {}, mod_efforts)
            got = "red" if v_p is not None else "green"
            if got != row.get("verdict"):
                mism.append((row.get("raw"), got, row.get("verdict"), v_p))
        tooth("E3: таблица паритета терминала -- вердикты прибора и мода совпадают",
              parity_err is None and parity and len(parity) >= 10 and not mism,
              f"err={parity_err} rows={len(parity or [])} расхождения={mism}",
              calls=1 + len(parity or []))
        tooth("E1: суффикс окна [2m] снимается той же нормализацией, что [1m]",
              norm_model_id(" Claude-Opus-5-5[2M] ") == "claude-opus-5-5"
              and norm_model_id("claude-opus-5-5[1m]") == "claude-opus-5-5"
              and norm_model_id("m[3m]") == "m[3m]",
              f"[2M]={norm_model_id(' Claude-Opus-5-5[2M] ')!r} [3m]={norm_model_id('m[3m]')!r}",
              calls=0)

        # A5: devin/swe-2 допущена в клетки сетки -- семейство прибору известно.
        table_devin = table_with(
            '[classes.crit-form]\nlabel = "c"\nallowed = ["grok-4.6", "devin/swe-2"]\n'
            '[pins]\n"grok-4.6" = ["medium", "max"]\n"devin/swe-2" = ["high"]\n')
        reason, vs, *_ = check(
            '[failover.class.crit-form]\nmodels = [{model = "grok-4.6", effort = "medium"}, '
            '{model = "devin/swe-2", effort = "high"}]\n', table_path=table_devin)
        tooth("A5: ступень devin/swe-2 -- семейство опознано, зелёно",
              reason is None and not vs,
              f"reason={reason} violations={vs}")

        # A4: правило-1 -- по СЛИТОМУ допуску (база + машинный слой).
        machine_excl = table_with(
            '[classes.exec-0n]\nlabel = "m"\nallowed = ["glm-5.3", "qwen3.8-flash"]\n')
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "grok-4.6"]\n',
            machine_path=machine_excl)
        va = " ".join(vs or [])
        tooth("A4: машинный слой снимает ступень -- правило-1-допуск (слитый допуск)",
              reason is None and vs
              and any("правило-1-допуск" in x and "grok-4.6" in x and "слитый допуск" in x
                      for x in vs),
              f"reason={reason} violations={vs}")
        table_anth = table_with(
            '[classes.exec-0n]\nlabel = "t"\n'
            'allowed = ["glm-5.3", "grok-4.6", "opus", "claude-opus-5-5[1m]"]\n')
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "grok-4.6"]\n',
            table_path=table_anth)
        tooth("A4: Anthropic-носитель допуска полноту не требует",
              reason is None and not vs,
              f"reason={reason} violations={vs}")
        machine_bad = table_with('[classes.exec-0n\n')
        reason, vs, *_ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "grok-4.6"]\n',
            machine_path=machine_bad)
        tooth("A4: нечитаемый машинный слой -- отказ прибора, не откат к базе",
              reason is not None and "машинный" in reason and vs is None,
              f"reason={reason} violations={vs}")

        main_cwd = os.path.join(work, "main-cwd")
        os.makedirs(main_cwd)

        def capture_main_raw(argv, env=None, cwd=None):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv, root=main_root, env={} if env is None else env,
                          home=main_home, cwd=main_cwd if cwd is None else cwd)
            return rc, out.getvalue(), err.getvalue()

        capture_main = guarded(capture_main_raw, (None, "", ""))

        def main_tooth(number, name, result, expected, calls=1):
            tooth(f"#231 ветвь {number}: {name}", result == expected,
                  f"получено={result!r}, ожидалось={expected!r}", calls=calls)

        main_tooth(1, "--registry без пути", capture_main(["--registry"]),
                   (2, "", "ПРИБОР НЕДОСТУПЕН: --registry без пути\n"))
        main_tooth(2, "таблица отсутствует", capture_main([]),
                   (2, "", "ПРИБОР НЕДОСТУПЕН: таблица маршрутизации не найдена: "
                    f"{main_table}\n"))

        os.makedirs(os.path.dirname(main_table))

        def write_main(table_text):
            with open(main_table, "w", encoding="utf-8") as f:
                f.write(table_text)

        def main_table_text(extra=""):
            with open(table_valid, encoding="utf-8") as src:
                return src.read() + extra

        write_main(main_table_text())
        main_tooth(3, "ошибка выбора реестра",
                   capture_main([], env={ENV_REGISTRY_VAR: fake_explicit}),
                   (2, "", f"ПРИБОР НЕДОСТУПЕН: env {ENV_REGISTRY_VAR} указывает "
                    f"на отсутствующий файл: {fake_explicit} "
                    "(понизить указ до следующего кандидата прибор не вправе)\n"))
        sibling = os.path.join(work, "Catalyst-CC-Patch", "probes", "probes.toml")
        live = os.path.join(main_home, ".claude", "probes", "probes.toml")
        main_tooth(4, "реестр отсутствует, оба кандидата названы", capture_main([]),
                   (2, "", "ПРИБОР НЕДОСТУПЕН: реестр probes.toml не найден. "
                    "Искал по порядку:\n"
                    f"  - соседний канон: {sibling}\n  - боевой: {live}\n"))

        bad_shape = reg("failover = 42\n")
        main_tooth(5, "отказ проверки лестниц",
                   capture_main(["--registry", bad_shape]),
                   (2, "", f"ПРИБОР НЕДОСТУПЕН: реестр {bad_shape}: секция "
                    "[failover] не таблица -- форма лестниц не разобрана\n"))
        # три правила на одном реестре: каждое нарушение своей строкой.
        write_main(main_table_text())
        bad_rungs = reg('[failover.class.exec-0n]\n'
                        'models = ["glm-5.3-flash", "opus"]\n')
        expected_violations = (
            "НАРУШЕНИЕ правило-1-допуск: клетка exec-0n, ступень glm-5.3-flash — "
            "вне допуска клетки: нет в [classes.exec-0n].allowed "
            "(слитый допуск: база + машинный + проектный)\n"
            "НАРУШЕНИЕ правило-2-антропик: клетка exec-0n, ступень opus — "
            "Anthropic-носитель в лестнице запрещён: автоматический переход "
            "на него обошёл бы маркер [anthropic-exception:…] молча\n"
            "НАРУШЕНИЕ правило-6-терминал: ключ [failover].terminal не "
            "объявлен — клетка, исчерпавшая лестницу, останется без "
            "дефолта\n"
        )
        main_tooth(6, "нарушения отдельными строками",
                   capture_main(["--registry", bad_rungs]),
                   (1, expected_violations, ""))
        # реестр без [failover]: правило-6 не идёт, ноль лестниц по-прежнему код 3.
        write_main(main_table_text())
        empty = reg('[probe.x]\ny = 1\n')
        main_tooth(7, "пустой предмет не измерен",
                   capture_main(["--registry", empty]),
                   (3, f"НЕ ИЗМЕРЕНО: в реестре {empty} не разобрано ни одной "
                    "таблицы [failover.*] — пустой результат без предмета нулём "
                    "не считается\n", ""))
        # зелёный итог несёт имя терминала в вердикте.
        write_main(main_table_text('[classes.solo5]\nlabel = "s"\nallowed = ["glm-5.3", "gpt-6-astra"]\n'))
        valid = reg('[failover]\nterminal = "claude-opus-5-5"\n\n[failover.class.exec-0n]\nmodels = [{model = "glm-5.3", effort = "max"}, "grok-4.6"]\n')
        main_tooth(8, "зелёный итог",
                   capture_main([], env={ENV_REGISTRY_VAR: valid}),
                   (0, verdict_line_s(valid, 1, 2, 1, 2, "claude-opus-5-5") + "\n", ""),
                   calls=2)

        # A4 через main: машинный слой берётся из HOME и назван в вердикте.
        machine_home = os.path.join(main_home, ".claude", "catalyst",
                                    "routing-override.toml")
        os.makedirs(os.path.dirname(machine_home))
        with open(machine_home, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "m"\nallowed = ["glm-5.3"]\n')
        rc_m, out_m, err_m = capture_main([], env={ENV_REGISTRY_VAR: valid})
        tooth("A4 main: машинный слой HOME снимает ступень -- код 1",
              rc_m == 1 and "правило-1-допуск" in out_m and "grok-4.6" in out_m
              and err_m == "",
              f"rc={rc_m} out={out_m!r} err={err_m!r}")
        with open(machine_home, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "m"\nallowed = ["glm-5.3", "grok-4.6"]\n')
        rc_m, out_m, err_m = capture_main([], env={ENV_REGISTRY_VAR: valid})
        tooth("A4 main: машинный слой назван в вердикте",
              rc_m == 0 and "(слитый допуск: база+машинный)" in out_m,
              f"rc={rc_m} out={out_m!r} err={err_m!r}")

        # F: проектный слой -- от --project и от cwd.
        proj = os.path.join(work, "proj")
        proj_probes = os.path.join(proj, ".claude", "probes", "probes.toml")
        os.makedirs(os.path.dirname(proj_probes))
        with open(proj_probes, "w", encoding="utf-8") as f:
            f.write('[failover]\nterminal = "opus"\n')
        rc_f, out_f, err_f = capture_main(["--project", proj],
                                          env={ENV_REGISTRY_VAR: valid})
        tooth("F: проектный терминал-алиас (--project) -- красен",
              rc_f == 1 and "правило-6-терминал" in out_f and "алиас" in out_f,
              f"rc={rc_f} out={out_f!r} err={err_f!r}")
        with open(proj_probes, "w", encoding="utf-8") as f:
            f.write('[failover.class.exec-0n]\nmodels = ["glm-5.3", "grok-4.6", "qwen3.8-flash"]\n')
        proj_sub = os.path.join(proj, "sub", "deeper")
        os.makedirs(proj_sub)
        rc_f, out_f, err_f = capture_main([], env={ENV_REGISTRY_VAR: valid},
                                          cwd=proj_sub)
        tooth("F: проектная лестница с недопущенной (поиск от cwd) -- красна",
              rc_f == 1 and "правило-1-допуск" in out_f
              and "qwen3.8-flash" in out_f,
              f"rc={rc_f} out={out_f!r} err={err_f!r}")
        proj_override = os.path.join(proj, ".claude", "catalyst",
                                     "routing-override.toml")
        os.makedirs(os.path.dirname(proj_override))
        with open(proj_override, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "p"\n'
                    'allowed = ["glm-5.3", "grok-4.6", "qwen3.8-flash"]\n')
        rc_f, out_f, err_f = capture_main(["--project", proj],
                                          env={ENV_REGISTRY_VAR: valid})
        tooth("F: проектный слой допуска допускает ступень -- зелёно, слой назван",
              rc_f == 0 and "(слитый допуск: база+машинный+проектный)" in out_f,
              f"rc={rc_f} out={out_f!r} err={err_f!r}")
        upper = reg('[failover]\nterminal = "Claude-Opus-5-5[1M]"\n\n[failover.class.exec-0n]\n'
                    'models = [{model = "glm-5.3", effort = "max"}, "grok-4.6"]\n')
        rc_c, out_c, err_c = capture_main([], env={ENV_REGISTRY_VAR: upper})
        tooth("FIX4-(б) main: терминал в верхнем регистре -- код 1, строка называет ключ и значение",
              rc_c == 1 and err_c == "" and out_c == (
                  "НАРУШЕНИЕ правило-6-канон: [failover].terminal = 'Claude-Opus-5-5[1M]' — "
                  "неканоничная форма (пробельные символы или верхний регистр); канон пишет id "
                  "без пробелов в нижнем регистре\n"),
              f"rc={rc_c} out={out_c!r} err={err_c!r}")
        tabbed = reg('[failover]\nterminal = "claude-opus-5-5\\t[1m]"\n\n[failover.class.exec-0n]\n'
                     'models = [{model = "glm-5.3", effort = "max"}, "grok-4.6"]\n')
        rc_t, out_t, err_t = capture_main([], env={ENV_REGISTRY_VAR: tabbed})
        tooth("FIX5 Р6 main: таб внутри id терминала -- код 1, строка называет ключ и значение",
              rc_t == 1 and err_t == "" and out_t == (
                  "НАРУШЕНИЕ правило-6-канон: [failover].terminal = 'claude-opus-5-5\\t[1m]' — "
                  "неканоничная форма (пробельные символы или верхний регистр); канон пишет id "
                  "без пробелов в нижнем регистре\n"),
              f"rc={rc_t} out={out_t!r} err={err_t!r}")

    book.close()
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


def main(argv, root=None, env=None, home=None, cwd=None):
    root = tool_root() if root is None else root
    envd = os.environ if env is None else env
    homed = os.path.expanduser("~") if home is None else home
    if "--self-check" in argv:
        return self_check()

    table_path = os.path.join(root, "hooks", "routing-table.toml")
    explicit_reg = None
    if "--registry" in argv:
        i = argv.index("--registry")
        if i + 1 >= len(argv):
            print("ПРИБОР НЕДОСТУПЕН: --registry без пути", file=sys.stderr)
            return 2
        explicit_reg = argv[i + 1]
    project_dir = None
    if "--project" in argv:
        i = argv.index("--project")
        if i + 1 >= len(argv):
            print("ПРИБОР НЕДОСТУПЕН: --project без пути", file=sys.stderr)
            return 2
        project_dir = argv[i + 1]
        if not os.path.isdir(project_dir):
            print(f"ПРИБОР НЕДОСТУПЕН: --project не каталог: {project_dir}",
                  file=sys.stderr)
            return 2

    if not os.path.isfile(table_path):
        print("ПРИБОР НЕДОСТУПЕН: таблица маршрутизации не найдена: "
              f"{table_path}", file=sys.stderr)
        return 2

    if explicit_reg is not None:
        registry_path = explicit_reg
    else:
        registry_path, attempts, err = resolve_registry(root, env=envd, home=homed)
        if err is not None:
            print(f"ПРИБОР НЕДОСТУПЕН: {err}", file=sys.stderr)
            return 2
        if registry_path is None:
            print("ПРИБОР НЕДОСТУПЕН: реестр probes.toml не найден. "
                  "Искал по порядку:", file=sys.stderr)
            for label, path in attempts:
                print(f"  - {label}: {path}", file=sys.stderr)
            return 2

    # CONSTRAINT (#509-FIX1 A4/F): слои -- поиском мода и гварда: машинный
    # дом по HOME, проектные -- ближайшие вверх от --project или cwd; дом
    # машинного слоя проектным не становится, боевой глобальный реестр и сам
    # предмет -- проектным реестром тоже.
    start = project_dir if project_dir is not None else (os.getcwd() if cwd is None else cwd)
    machine = os.path.join(homed, ".claude", "catalyst", "routing-override.toml")
    project_override = find_upward(start, PROJECT_OVERRIDE_REL, exclude=(machine,))
    live_global = os.path.join(homed, ".claude", "probes", "probes.toml")
    project_registry = find_upward(start, PROJECT_PROBES_REL,
                                   exclude=(live_global, registry_path))
    efforts, _eff_err = load_mod_efforts(root)

    reason, violations, ladders, rungs, effort_rungs, classes_checked, terminal = check_ladders(
        registry_path, table_path, machine_path=machine,
        project_override=project_override, project_registry=project_registry,
        efforts=efforts)
    if reason is not None:
        print(f"ПРИБОР НЕДОСТУПЕН: {reason}", file=sys.stderr)
        return 2
    if violations:
        for v in violations:
            print(v)
        return 1
    if ladders == 0:
        print(f"НЕ ИЗМЕРЕНО: в реестре {registry_path} не разобрано ни одной "
              "таблицы [failover.*] — пустой результат без предмета нулём "
              "не считается")
        return 3
    _tab, layers, _err = load_layers(table_path, machine, project_override)
    print(verdict_line(registry_path, ladders, rungs, effort_rungs,
                       classes_checked, terminal, layers or "база"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
