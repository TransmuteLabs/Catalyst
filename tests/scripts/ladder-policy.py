#!/usr/bin/env python3
"""Статический прибор политики лестниц замены модели (failover).

Предмет: таблицы [failover.class.<id>] в реестре проб probes.toml против
допуска клеток [classes.<id>].allowed в hooks/routing-table.toml. Мод
(plugins/catalyst-probes/hooks/register.ts) routing-table.toml ЧИТАЕТ --
допуск клеток без явной лестницы строится из [classes.<id>].allowed той же
таблицы (loadAllowedByClass, allowed-ветка failoverLadderBind). Гейт
диспатча срабатывает на вызове инструмента, тогда как лестница меняет
модель уже ПОСЛЕ него и вторым вызовом не проверяется -- поэтому проверка
обязана быть внешней и статической. Пять правил и разбор элемента
(брифы #225 и #230 -- адъюдикация контроллера 2026-09-16; #261 -- 2026-09-18;
#274/#275 -- 2026-09-19):

  правило-1-допуск: каждая ступень каждой [failover.class.<id>] обязана быть
    в [classes.<id>].allowed. Класса нет в таблице -- нарушение с названной
    клеткой, не тихий пропуск. Предикат -- гварда: str(x).strip().lower()
    с обеих сторон (check_class_admits, hooks/dispatch-gate.py).
  правило-2-антропик: ни одна ступень не смеет быть Anthropic-носителем:
    автоматический переход на него обошёл бы маркер [anthropic-exception:…]
    молча. Признак -- по объявленным ниже семействам; имя, не опознанное НИ
    одним семейством, -- нарушение «семейство не определено»: слепота
    прибора обязана быть слышна, иначе новая модель молча выключит правило.
  правило-3-эффорт: объявленный effort ступени обязан быть в [pins] своей
    модели (hooks/routing-table.toml). Нет записи в [pins] -- отдельная
    причина «пин-эффорта-не-объявлен» (пусто ≠ ноль), не молчаливый допуск.
    Ступень без effort правило 3 не задевает.
  правило-4-запас: каждый класс таблицы с НЕПУСТЫМ допуском обязан нести
    минимум две модели (после той же нормализации, что у гварда: str.lower).
    Иначе ни лестница, ни дефолт не дают переход: правило-1 требует
    ladder ⊆ allowed. Класс с пустым допуском правило-4 не задевает:
    он не делегируется, диспатчей у него нет. Сканируются ВСЕ классы
    таблицы, не только те, у кого есть лестница.
  правило-5-веер: клетка БЕЗ явной лестницы получает веер из allowed-ветки
    -- её допуск обязан быть ПОДМНОЖЕСТВОМ оверрайд-допуска той же клетки
    (гвард меряет допуск слоями: база → машинный ~/.claude/catalyst/
    routing-override.toml → проектный, запись клетки заменяет базовую
    ЦЕЛИКОМ -- load_table/override_paths, hooks/dispatch-gate.py). Мод,
    читающий только базу, строит веер шире допуска гварда -- переход на
    ступень, которую гвард отверг бы (#274). Источник веера мода прибор
    выводит из исходника register.ts: чтение слоёв опознаётся по литералу
    routing-override; мод без слоёв меряется базовым allowed. Туда же
    распространён антропик-фильтр правила-2: Anthropic-имя в allowed-ветке
    клетки без лестницы -- то же молчаливое обходание маркера.
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
    "opus", "claude-opus-5[1m]", "fable", "fable-5-1",
    "claude-fable-5-1", "claude-fable-5-1[1m]",
)
ANTHROPIC_PREFIXES = ("claude",)
# Вендорские семейства -- префиксы id из допуска сетки
# (hooks/routing-table.toml [classes.*].allowed, ценз 2026-09-16) и флота:
# glm-5.3/5.3-flash, grok-4.6, qwen3.8-flash, gpt-6-astra, gpt-5.6-sol/luna,
# deepseek-flash/v4-pro, kimi-k3 -- там же; MiniMax-M3 --
# tests/scripts/test-dispatch-stats.sh (модель флота).
VENDOR_FAMILY_PREFIXES = (
    "glm-", "grok-", "qwen", "gpt-", "deepseek-", "kimi-", "minimax",
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


# --- правило-5-веер: слои допуска, как их меряет гвард ------------------------
# CONSTRAINT: порядок и семантика слоёв -- ДОСЛОВНО dispatch-gate.py
# (override_paths + load_table): машинный затем проектный, запись клетки
# ЗАМЕНЯЕТ базовую целиком, дубликат по абspath в слой не попадает.
# Второй дом этих правил расходился бы с гвардом молча -- паритет и есть
# предмет правила.
PROJECT_OVERRIDE_REL = os.path.join(".claude", "catalyst", "routing-override.toml")


def find_project_override(start_dir):
    """Ближайший .claude/catalyst/routing-override.toml от start_dir вверх -- как гвард."""
    d = os.path.abspath(start_dir or os.getcwd())
    while True:
        cand = os.path.join(d, PROJECT_OVERRIDE_REL)
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def resolve_override_layers(root, env=None, home=None):
    """Пути слоёв допуска (машина, затем проект), наименьший первым.

    env-ручки -- те же, что у гварда: CATALYST_ROUTING_OVERRIDE задаёт машинный
    слой ЦЕЛИКОМ (включая пустое значение), CATALYST_ROUTING_PROJECT_OVERRIDE --
    проектный; без ручек машинный -- <home>/.claude/catalyst/routing-override.toml,
    проектный ищется от корня репо вверх.
    """
    envd = os.environ if env is None else env
    if home is None:
        home = os.path.expanduser("~")
    layers = []
    env_home = envd.get("CATALYST_ROUTING_OVERRIDE")
    machine = env_home if env_home is not None else os.path.join(
        str(home), ".claude", "catalyst", "routing-override.toml")
    layers.append(machine)
    env_proj = envd.get("CATALYST_ROUTING_PROJECT_OVERRIDE")
    project = env_proj if env_proj is not None else find_project_override(root)
    if project and os.path.abspath(project) not in {os.path.abspath(l) for l in layers}:
        layers.append(project)
    return layers


def merge_admission(grid, override_paths):
    """(cell -> set(strip().lower() имён), None) или (None, причина).

    База -- [classes.*].allowed поданной таблицы; каждый существующий слой
    заменяет названную клетку ЦЕЛИКОМ (без allowed -- допуск пуст: так же
    отказывает гвард). Несуществующий слой пропускается; битый слой --
    отказ прибора: молчаливый откат к базе и есть чинимый дефект (#274).
    """
    merged = {}
    for cell, entry in grid.items():
        if not isinstance(entry, dict):
            continue
        allowed = entry.get("allowed")
        merged[cell] = [str(a) for a in allowed] if isinstance(allowed, list) else []
    for path in override_paths or []:
        if not path or not os.path.isfile(path):
            continue
        data, err = load_toml(path)
        if err is not None:
            return None, f"слой допуска не читается: {err}"
        ov_classes = data.get("classes")
        if ov_classes is None:
            continue
        if not isinstance(ov_classes, dict):
            return None, (f"слой допуска {path}: секция [classes] не таблица -- "
                          "форма замены клеток не разобрана")
        for cell, entry in ov_classes.items():
            allowed = entry.get("allowed") if isinstance(entry, dict) else None
            merged[cell] = [str(a) for a in allowed] if isinstance(allowed, list) else []
    return {cell: {str(a).strip().lower() for a in models}
            for cell, models in merged.items()}, None


def mod_reads_layers(mod_source_path):
    """(True/False, None) или (None, причина): мод строит веер по слоям?

    CONSTRAINT: признак -- литерал routing-override в исходнике мода: это
    имя файла слоя, который мод обязан читать при слоёном допуске. Греп по
    имени -- не парсер: вторая копия логики слоёв в приборе разошлась бы с
    модом молча, а исходник мода -- единственный дом его правды.
    """
    try:
        with open(mod_source_path, "r", encoding="utf-8") as f:
            return ("routing-override" in f.read()), None
    except OSError as e:
        return None, f"исходник мода не читается: {mod_source_path}: {e}"


_ANTHROPIC_LOW = frozenset(a.lower() for a in ANTHROPIC_EXACT_IDS)


def _is_anthropic_name(name):
    """Признак правила-2 для ЛЮБОГО имени модели (не только ступени)."""
    low = str(name).strip().lower()
    return low in _ANTHROPIC_LOW or low.startswith(ANTHROPIC_PREFIXES)

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
    # CONSTRAINT: обе стороны сравнения -- предикат гварда (strip().lower()),
    # не точное сравнение: "Glm-5.3" против allowed ["glm-5.3"] гвард пускает.
    if low not in {str(a).strip().lower() for a in allowed}:
        return (f"НАРУШЕНИЕ правило-1-допуск: клетка {cell}, ступень {name} — "
                f"вне допуска клетки: нет в [classes.{cell}].allowed "
                "(hooks/routing-table.toml)")
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


def verdict_line(registry_path, ladders, rungs, effort_rungs, classes_checked,
                 fan_checked=None):
    """Итоговая строка зелёного исхода. Один дом текста вердикта.

    CONSTRAINT: при НУЛЕ ступеней с объявленным эффортом правило-3 назвать
    соблюдённым нельзя -- у него пустой знаменатель, а пусто != ноль (тот же
    закон, по которому реестр без [failover.*] даёт НЕ ИЗМЕРЕНО, а не
    зелёное). Знаменатели каждого правила печатаются числом рядом, иначе
    читатель принимает молчание прибора за проверенность.
    CONSTRAINT: правило-5 печатается только когда прибор его МЕРЯЛ
    (fan_checked is not None): без исходника мода предмет правила отсутствует,
    и молчание здесь -- не проверенность, а неизмеренность (вызывающий
    обязан был отказаться раньше).
    """
    head = (f"лестниц {ladders} (ступеней {rungs}, с эффортом {effort_rungs}), "
            f"файл {registry_path}: ")
    rule4 = f"правило-4-запас — на всех {classes_checked} классах таблицы"
    if fan_checked is not None:
        rule4 += f"; правило-5-веер — на всех {fan_checked} клетках без лестницы"
    if effort_rungs == 0:
        return (head + f"правило-1-допуск и правило-2-антропик соблюдены на "
                f"всех {rungs} ступенях; правило-3-эффорт НЕ ИЗМЕРЕНО — "
                f"ступеней с объявленным эффортом 0; {rule4}")
    return (head + f"правило-1-допуск и правило-2-антропик соблюдены на всех "
            f"{rungs} ступенях, правило-3-эффорт — на всех {effort_rungs} "
            f"с объявленным эффортом, {rule4}")


def check_ladders(registry_path, table_path, mod_source_path=None,
                  override_paths=None, home=None, env=None):
    """(reason, violations, ladders, rungs, effort_rungs, classes_checked,
    fan_checked).

    reason None -- предмет измерим: violations -- список строк-нарушений
    (пустой = правила соблюдены), ladders -- число разобранных таблиц
    [failover.class.*], rungs -- число ступеней в них, effort_rungs --
    сколько из них с объявленным effort, classes_checked -- сколько
    классов таблицы просмотрело правило-4-запас, fan_checked -- сколько
    клеток без явной лестницы просмотрело правило-5-веер (None -- правило
    не мерялось: исходник мода не подан). reason не None -- прибор не в
    состоянии мерить (код 2).
    """
    _ua = (None, None, None, None, None, None)

    def unavail(msg):
        return (msg,) + _ua

    reg, err = load_toml(registry_path)
    if err is not None:
        return unavail(f"реестр: {err}")
    tab, err = load_toml(table_path)
    if err is not None:
        return unavail(f"таблица маршрутизации: {err}")

    failover = reg.get("failover")
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

    classes_checked = 0
    for cell, entry in grid.items():
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

    # правило-5-веер: клетки БЕЗ явной лестницы (источник веера мода).
    fan_checked = None
    if mod_source_path is not None:
        mod_layers, err = mod_reads_layers(mod_source_path)
        if err is not None:
            return unavail(err)
        if override_paths is None:
            override_paths = resolve_override_layers(
                table_path, env=env, home=home)
        layered, err = merge_admission(grid, override_paths)
        if err is not None:
            return unavail(err)
        fan_checked = 0
        for cell, entry in grid.items():
            if cell in classes_map:
                continue
            allowed = entry.get("allowed") or []
            if not allowed:
                continue
            fan_checked += 1
            # CONSTRAINT: источник веера -- тот же, у которого его берёт мод:
            # мод со слоями строит веер из слоёного допуска, мод без слоёв --
            # из базы. Сравнение с допуском ГВАРДА (всегда слоёным) ловит
            # расхождение ровно в состоянии мода, не в данных.
            fan = (layered.get(cell, set()) if mod_layers
                   else {str(a).strip().lower() for a in allowed})
            admit = layered.get(cell, set())
            extra = sorted(fan - admit)
            if extra:
                violations.append(
                    f"НАРУШЕНИЕ правило-5-веер: клетка {cell} — allowed-ветка "
                    f"шире оверрайд-допуска клетки: {', '.join(extra)} "
                    f"(мод {'со слоями' if mod_layers else 'без слоёв'} строит "
                    "веер, который гвард по слоям допуска не пропустит)"
                )
            anthropic = sorted(a for a in fan if _is_anthropic_name(a))
            if anthropic:
                violations.append(
                    f"НАРУШЕНИЕ правило-5-антропик: клетка {cell} — "
                    f"Anthropic-носители {', '.join(anthropic)} в allowed-ветке "
                    "без явной лестницы: автоматический переход обошёл бы "
                    "маркер [anthropic-exception:…] молча"
                )
    return (None, violations, ladders, rungs, effort_rungs, classes_checked,
            fan_checked)


def self_check():
    """Зубы прибора на синтетических входах, офлайн. 0 -- все зелёны."""
    teeth = []

    def tooth(name, ok, detail=""):
        teeth.append((name, bool(ok), detail))

    with tempfile.TemporaryDirectory(prefix="ladder-policy-selfcheck-") as work:
        def reg(text):
            p = os.path.join(work, f"reg-{len(teeth)}-{abs(hash(text)) % 9999}.toml")
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            return p

        table_valid = os.path.join(work, "table.toml")
        # CONSTRAINT: allowed клетки БЕЗ Anthropic-имён: правило-5-антропик
        # краснеет на allowed-ветке бесклеточника, и стол #231 с opus в
        # allowed делал бы ветви 7-8 (НЕ ИЗМЕРЕНО / зелёный итог) красными
        # без отношения к их предмету.
        with open(table_valid, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "t"\n'
                    'allowed = ["glm-5.3", "grok-4.6", "madeup-9"]\n'
                    '[pins]\n'
                    '"glm-5.3" = ["max"]\n'
                    '"grok-4.6" = ["medium", "max"]\n')

        def table_with(text):
            p = os.path.join(work, f"tab-{len(teeth)}-{abs(hash(text)) % 9999}.toml")
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            return p

        def check(registry_text=None, registry_path=None, table_path=None):
            r = registry_path or reg(registry_text)
            t = table_path or table_valid
            return check_ladders(r, t)

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
        p, att, err = resolve_registry(fake_root, env={ENV_REGISTRY_VAR: fake_explicit},
                                       home=fake_home)
        tooth("env указывает мимо -> громкий отказ с путём",
              p is None and err is not None and fake_explicit in err,
              f"path={p} err={err}")
        p, att, err = resolve_registry(fake_root, env={}, home=fake_home)
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
            'models = [{model = "glm-5.3", effort = "max"}]\n')
        tooth("богатая форма: допуск + эффорт в pins -> нет нарушений",
              reason is None and not vs and l == 1 and r == 1,
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
            'models = [{model = "glm-5.3"}]\n')
        tooth("богатая форма без effort -> правило 3 молчит",
              reason is None and not vs and l == 1 and r == 1
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
              f"cases={cases7}")

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
        vl0 = verdict_line("/р.toml", 20, 77, 0, 4)
        tooth("вердикт при нуле ступеней с эффортом -> правило-3 НЕ ИЗМЕРЕНО",
              "правило-3-эффорт НЕ ИЗМЕРЕНО" in vl0
              and "правило-3-эффорт — на всех" not in vl0
              and "77" in vl0
              and "правило-4-запас — на всех 4 классах таблицы" in vl0,
              f"строка={vl0!r}")
        vl1 = verdict_line("/р.toml", 20, 77, 5, 4)
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

        # --- правило-5-веер: выделенные зубы (волна ремонта 2026-09-19) --------
        # CONSTRAINT: #231-ветви пинят ПРОВОДКУ main() (резолв слоёв и исходника
        # мода); эти зубы пинят само правило-5 на прямом входе check_ladders --
        # мутация правила краснит их, не трогая ветви #231.
        def modsrc(with_layers: bool) -> str:
            p = os.path.join(work, f"mod-{'layers' if with_layers else 'base'}.ts")
            with open(p, "w", encoding="utf-8") as f:
                f.write("// синтетический исходник мода для правила-5\n"
                        + ('const layer = "routing-override"\n' if with_layers
                           else "const layer = base_only\n"))
            return p

        t5_reg = reg('[probe.x]\ny = 1\n')
        t5_base = table_with('[classes.nolad5]\nlabel = "n"\n'
                             'allowed = ["glm-5.3", "gpt-6-astra"]\n')
        t5_over = table_with('[classes.nolad5]\nallowed = ["glm-5.3"]\n')
        reason, vs, l, r, er, cc, fan = check_ladders(
            t5_reg, t5_base,
            mod_source_path=modsrc(False), override_paths=[t5_over])
        v5a = " ".join(vs or [])
        tooth("правило-5: мод без слоёв -- лишняя модель названа, клетка названа",
              reason is None and vs
              and any("правило-5-веер" in x and "nolad5" in x and "gpt-6-astra" in x
                      for x in vs)
              and fan == 1,
              f"reason={reason} violations={vs} fan={fan}")

        reason, vs, l, r, er, cc, fan = check_ladders(
            t5_reg,
            table_with('[classes.noanth5]\nlabel = "a"\nallowed = ["glm-5.3", "opus"]\n'),
            mod_source_path=modsrc(True), override_paths=[])
        tooth("правило-5: антропик в allowed-ветке бесклеточника красен и при слоях",
              reason is None and vs
              and any("правило-5-антропик" in x and "noanth5" in x and "opus" in x
                      for x in vs)
              and not any("правило-5-веер" in x for x in vs)
              and fan == 1,
              f"reason={reason} violations={vs} fan={fan}")

        reason, vs, l, r, er, cc, fan = check_ladders(
            t5_reg, t5_base,
            mod_source_path=modsrc(True), override_paths=[t5_over])
        tooth("правило-5: мод со слоями -- подмножество зелено, счётчик веера жив",
              reason is None and not vs and fan == 1,
              f"reason={reason} violations={vs} fan={fan}")

        t5_broken = table_with('[classes.nolad5\nallowed = ["glm-5.3"]\n')
        reason, vs, *_ = check_ladders(
            t5_reg, t5_base,
            mod_source_path=modsrc(True), override_paths=[t5_broken])
        tooth("правило-5: битый слой допуска -- отказ прибора с путём, не пустой допуск",
              reason is not None and t5_broken in reason and vs is None,
              f"reason={reason}")


        def capture_main(argv, env=None):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv, root=main_root, env={} if env is None else env,
                          home=main_home)
            return rc, out.getvalue(), err.getvalue()

        def main_tooth(number, name, result, expected):
            tooth(f"#231 ветвь {number}: {name}", result == expected,
                  f"получено={result!r}, ожидалось={expected!r}")

        main_tooth(1, "--registry без пути", capture_main(["--registry"]),
                   (2, "", "ПРИБОР НЕДОСТУПЕН: --registry без пути\n"))
        main_tooth(2, "таблица отсутствует", capture_main([]),
                   (2, "", "ПРИБОР НЕДОСТУПЕН: таблица маршрутизации не найдена: "
                    f"{main_table}\n"))

        os.makedirs(os.path.dirname(main_table))
        mod_source = os.path.join(main_root, "plugins", "catalyst-probes",
                                  "hooks", "register.ts")
        os.makedirs(os.path.dirname(mod_source))
        machine_override = os.path.join(main_home, ".claude", "catalyst",
                                        "routing-override.toml")
        os.makedirs(os.path.dirname(machine_override))

        def write_main(table_text, mod_with_layers):
            with open(main_table, "w", encoding="utf-8") as f:
                f.write(table_text)
            # CONSTRAINT: содержимое -- только признак правила-5 (литерал
            # routing-override); логику мода прибор не исполняет.
            with open(mod_source, "w", encoding="utf-8") as f:
                f.write("// синтетический стол правила-5\n" +
                        ("const layer = \"routing-override\"\n"
                         if mod_with_layers else "const layer = \"base-only\"\n"))

        def main_table_text(extra=""):
            with open(table_valid, encoding="utf-8") as src:
                return src.read() + extra

        write_main(main_table_text(), mod_with_layers=False)
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
        # правило-5, красная сторона: мод БЕЗ слоёв строит веер из базы,
        # оверрайд сужает допуск клетки без лестницы -- лишняя модель названа;
        # бесклеточник с Anthropic в allowed красен антропик-половиной.
        with open(machine_override, "w", encoding="utf-8") as f:
            f.write('[classes.solo5]\nallowed = ["glm-5.3"]\n')
        write_main(
            main_table_text('[classes.solo5]\nlabel = "s"\n'
                            'allowed = ["glm-5.3", "gpt-6-astra"]\n'
                            '[classes.anth5]\nlabel = "a"\n'
                            'allowed = ["glm-5.3", "opus"]\n'),
            mod_with_layers=False)
        bad_rungs = reg('[failover.class.exec-0n]\n'
                        'models = ["glm-5.3-flash", "opus"]\n')
        expected_violations = (
            "НАРУШЕНИЕ правило-1-допуск: клетка exec-0n, ступень glm-5.3-flash — "
            "вне допуска клетки: нет в [classes.exec-0n].allowed "
            "(hooks/routing-table.toml)\n"
            "НАРУШЕНИЕ правило-2-антропик: клетка exec-0n, ступень opus — "
            "Anthropic-носитель в лестнице запрещён: автоматический переход "
            "на него обошёл бы маркер [anthropic-exception:…] молча\n"
            "НАРУШЕНИЕ правило-5-веер: клетка solo5 — allowed-ветка "
            "шире оверрайд-допуска клетки: gpt-6-astra "
            "(мод без слоёв строит веер, который гвард по слоям допуска "
            "не пропустит)\n"
            "НАРУШЕНИЕ правило-5-антропик: клетка anth5 — "
            "Anthropic-носители opus в allowed-ветке "
            "без явной лестницы: автоматический переход обошёл бы "
            "маркер [anthropic-exception:…] молча\n"
        )
        main_tooth(6, "нарушения отдельными строками",
                   capture_main(["--registry", bad_rungs]),
                   (1, expected_violations, ""))
        # правило-5 не перекрывает НЕ ИЗМЕРЕНО: бесклеточников нет -- violations
        # пусты, ноль лестниц по-прежнему код 3.
        write_main(main_table_text(), mod_with_layers=False)
        empty = reg('[probe.x]\ny = 1\n')
        main_tooth(7, "пустой предмет не измерен",
                   capture_main(["--registry", empty]),
                   (3, f"НЕ ИЗМЕРЕНО: в реестре {empty} не разобрано ни одной "
                    "таблицы [failover.*] — пустой результат без предмета нулём "
                    "не считается\n", ""))
        # правило-5, зелёная сторона: мод СО слоями строит веер из слоёного
        # допуска -- подмножество выполняется, счётчик веера в вердикте.
        write_main(
            main_table_text('[classes.solo5]\nlabel = "s"\n'
                            'allowed = ["glm-5.3", "gpt-6-astra"]\n'),
            mod_with_layers=True)
        valid = reg('[failover.class.exec-0n]\n'
                    'models = [{model = "glm-5.3", effort = "max"}]\n')
        main_tooth(8, "зелёный итог",
                   capture_main([], env={ENV_REGISTRY_VAR: valid}),
                   (0, verdict_line(valid, 1, 1, 1, 2, 1) + "\n", ""))

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


def main(argv, root=None, env=None, home=None):
    root = tool_root() if root is None else root
    envd = os.environ if env is None else env
    homed = os.path.expanduser("~") if home is None else home
    if "--self-check" in argv:
        return self_check()

    table_path = os.path.join(root, "hooks", "routing-table.toml")
    mod_source = os.path.join(root, "plugins", "catalyst-probes", "hooks",
                              "register.ts")
    explicit_reg = None
    if "--registry" in argv:
        i = argv.index("--registry")
        if i + 1 >= len(argv):
            print("ПРИБОР НЕДОСТУПЕН: --registry без пути", file=sys.stderr)
            return 2
        explicit_reg = argv[i + 1]

    if not os.path.isfile(table_path):
        print("ПРИБОР НЕДОСТУПЕН: таблица маршрутизации не найдена: "
              f"{table_path}", file=sys.stderr)
        return 2
    if not os.path.isfile(mod_source):
        print("ПРИБОР НЕДОСТУПЕН: исходник мода не найден: "
              f"{mod_source} -- правило-5-веер без него неизмеримо",
              file=sys.stderr)
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

    override_paths = resolve_override_layers(root, env=envd, home=homed)
    reason, violations, ladders, rungs, effort_rungs, classes_checked, fan_checked = check_ladders(
        registry_path, table_path, mod_source_path=mod_source,
        override_paths=override_paths)
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
    print(verdict_line(registry_path, ladders, rungs, effort_rungs,
                       classes_checked, fan_checked))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
