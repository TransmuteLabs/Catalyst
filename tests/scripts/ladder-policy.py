#!/usr/bin/env python3
"""Статический прибор политики лестниц замены модели (failover).

Предмет: таблицы [failover.class.<id>] в реестре проб probes.toml против
допуска клеток [classes.<id>].allowed в hooks/routing-table.toml. Мод
(plugins/catalyst-probes/hooks/register.ts) routing-table.toml НЕ читает
нигде, а гейт диспатча срабатывает на вызове инструмента, тогда как лестница
меняет модель уже ПОСЛЕ него и вторым вызовом не проверяется -- поэтому
проверка обязана быть внешней и статической. Три правила и разбор элемента
(брифы #225 и #230, адъюдикация контроллера 2026-09-16):

  правило-1-допуск: каждая ступень каждой [failover.class.<id>] обязана быть
    в [classes.<id>].allowed. Класса нет в таблице -- нарушение с названной
    клеткой, не тихий пропуск.
  правило-2-антропик: ни одна ступень не смеет быть Anthropic-носителем:
    автоматический переход на него обошёл бы маркер [anthropic-exception:…]
    молча. Признак -- по объявленным ниже семействам; имя, не опознанное НИ
    одним семейством, -- нарушение «семейство не определено»: слепота
    прибора обязана быть слышна, иначе новая модель молча выключит правило.
  правило-3-эффорт: объявленный effort ступени обязан быть в [pins] своей
    модели (hooks/routing-table.toml). Нет записи в [pins] -- отдельная
    причина «пин-эффорта-не-объявлен» (пусто ≠ ноль), не молчаливый допуск.
    Ступень без effort правило 3 не задевает.
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


_ANTHROPIC_LOW = frozenset(a.lower() for a in ANTHROPIC_EXACT_IDS)

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
    ключ -> правило-3-эффорт. На ступень -- первое совпадение. Допуск и
    [pins] сверяются ТОЧНО, семейства -- по префиксам без регистра.

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
    low = name.lower()
    if low in _ANTHROPIC_LOW or low.startswith(ANTHROPIC_PREFIXES):
        return (f"НАРУШЕНИЕ правило-2-антропик: клетка {cell}, ступень {name} — "
                "Anthropic-носитель в лестнице запрещён: автоматический переход "
                "на него обошёл бы маркер [anthropic-exception:…] молча")
    if not low.startswith(VENDOR_FAMILY_PREFIXES):
        return (f"НАРУШЕНИЕ семейство-не-определено: клетка {cell}, ступень {name} — "
                "семейство не определено: имя не опознано ни одним объявленным "
                "семейством прибора")
    if name not in allowed:
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


def verdict_line(registry_path, ladders, rungs, effort_rungs):
    """Итоговая строка зелёного исхода. Один дом текста вердикта.

    CONSTRAINT: при НУЛЕ ступеней с объявленным эффортом правило-3 назвать
    соблюдённым нельзя -- у него пустой знаменатель, а пусто != ноль (тот же
    закон, по которому реестр без [failover.*] даёт НЕ ИЗМЕРЕНО, а не
    зелёное). Знаменатели каждого правила печатаются числом рядом, иначе
    читатель принимает молчание прибора за проверенность.
    """
    head = (f"лестниц {ladders} (ступеней {rungs}, с эффортом {effort_rungs}), "
            f"файл {registry_path}: ")
    if effort_rungs == 0:
        return (head + f"правило-1-допуск и правило-2-антропик соблюдены на "
                f"всех {rungs} ступенях; правило-3-эффорт НЕ ИЗМЕРЕНО — "
                "ступеней с объявленным эффортом 0")
    return (head + f"правило-1-допуск и правило-2-антропик соблюдены на всех "
            f"{rungs} ступенях, правило-3-эффорт — на всех {effort_rungs} "
            "с объявленным эффортом")


def check_ladders(registry_path, table_path):
    """(reason, violations, ladders, rungs, effort_rungs).

    reason None -- предмет измерим: violations -- список строк-нарушений
    (пустой = правила соблюдены), ladders -- число разобранных таблиц
    [failover.class.*], rungs -- число ступеней в них, effort_rungs --
    сколько из них с объявленным effort. reason не None -- прибор не в
    состоянии мерить (код 2).
    """
    reg, err = load_toml(registry_path)
    if err is not None:
        return f"реестр: {err}", None, None, None, None
    tab, err = load_toml(table_path)
    if err is not None:
        return f"таблица маршрутизации: {err}", None, None, None, None

    failover = reg.get("failover")
    if failover is None:
        return None, [], 0, 0, 0
    if not isinstance(failover, dict):
        return (f"реестр {registry_path}: секция [failover] не таблица -- "
                "форма лестниц не разобрана"), None, None, None, None
    classes_map = failover.get("class")
    if classes_map is None:
        return None, [], 0, 0, 0
    if not isinstance(classes_map, dict):
        return (f"реестр {registry_path}: секция [failover.class] не таблица -- "
                "форма лестниц не разобрана"), None, None, None, None
    grid = tab.get("classes", {})
    if not isinstance(grid, dict):
        return (f"таблица {table_path}: секция [classes] не таблица -- "
                "допуск клеток не разобран"), None, None, None, None
    pins = tab.get("pins", {})
    if not isinstance(pins, dict):
        return (f"таблица {table_path}: секция [pins] не таблица -- "
                "допуск эффорта не разобран"), None, None, None, None

    violations = []
    ladders = 0
    rungs = 0
    effort_rungs = 0
    for cell in classes_map:
        ladder = classes_map[cell]
        if not isinstance(ladder, dict):
            return (f"реестр {registry_path}: [failover.class.{cell}] не таблица -- "
                    "форма лестницы не разобрана"), None, None, None, None
        ladders += 1
        models = ladder.get("models", [])
        if not isinstance(models, list):
            return (f"реестр {registry_path}: [failover.class.{cell}].models не список -- "
                    "форма лестницы не разобрана"), None, None, None, None
        entry = grid.get(cell)
        if not isinstance(entry, dict):
            violations.append(
                f"НАРУШЕНИЕ правило-1-допуск: клетка {cell} — класса нет в "
                f"routing-table.toml: секции [classes.{cell}] нет"
            )
            continue
        allowed = entry.get("allowed", [])
        if not isinstance(allowed, list):
            return (f"таблица {table_path}: [classes.{cell}].allowed не список -- "
                    "допуск клетки не разобран"), None, None, None, None
        for index, rung in enumerate(models):
            rungs += 1
            parsed, _unknown = parse_rung_item(rung)
            if parsed is not None and parsed.get("effort"):
                effort_rungs += 1
            v = rung_violation(cell, rung, allowed, pins=pins, index=index)
            if v is not None:
                violations.append(v)
    return None, violations, ladders, rungs, effort_rungs


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
        with open(table_valid, "w", encoding="utf-8") as f:
            f.write('[classes.exec-0n]\nlabel = "t"\n'
                    'allowed = ["glm-5.3", "grok-4.6", "opus", "madeup-9"]\n'
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
        reason, vs, l, r, _ = check(
            '[failover]\nenabled = true\n\n[failover.class.exec-0n]\n'
            'models = ["glm-5.3", "grok-4.6"]\n')
        tooth("положительный контроль: валидная лестница зелена",
              reason is None and not vs and l == 1 and r == 2,
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        # зуб 1: ступень вне допуска клетки -> нарушение правило-1-допуск,
        # названы клетка и ступень
        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "glm-5.3-flash"]\n')
        v1 = " ".join(vs)
        tooth("ступень вне допуска -> правило-1-допуск с клеткой и ступенью",
              reason is None and vs
              and any("правило-1-допуск" in x for x in vs)
              and "exec-0n" in v1 and "glm-5.3-flash" in v1,
              f"reason={reason} violations={vs}")

        # зуб 2: Anthropic-имя в лестнице -> правило-2-антропик
        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "opus"]\n')
        v2 = " ".join(vs)
        tooth("Anthropic-имя -> правило-2-антропик",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "opus" in v2,
              f"reason={reason} violations={vs}")

        # зуб 3: имя, не опознанное ни одним семейством -> «семейство не
        # определено» (слепота прибора обязана быть слышна)
        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "madeup-9"]\n')
        v3 = " ".join(vs)
        tooth("неизвестное имя -> «семейство не определено»",
              reason is None and vs
              and any("семейство не определено" in x for x in vs)
              and "madeup-9" in v3,
              f"reason={reason} violations={vs}")

        # зуб 4: реестр без единой таблицы [failover.*] -> НОЛЬ лестниц
        # (это НЕ ИЗМЕРЕНО, код 3, а не зелёный)
        reason, vs, l, _, _ = check('[probe.x]\ny = 1\n')
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
        reason, vs, _, _, _ = check(registry_path=fake_reg)
        tooth("явный путь отсутствующего реестра -> отказ с названным путём",
              reason is not None and fake_reg in reason and vs is None,
              f"reason={reason}")

        # новые зубы 1–8: богатая форма ступени (бриф #230). Нумерация в именах
        # — нумерация брифа, не индекс печати (существующие 8 зубов впереди).
        reason, vs, l, r, _ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3", effort = "max"}]\n')
        tooth("богатая форма: допуск + эффорт в pins -> нет нарушений",
              reason is None and not vs and l == 1 and r == 1,
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "opus", effort = "high"}]\n')
        v_rich_anth = " ".join(vs or [])
        tooth("богатая форма: Anthropic -> правило-2-антропик",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "opus" in v_rich_anth
              and not any("семейство-не-определено" in x for x in vs),
              f"reason={reason} violations={vs}")

        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "glm-5.3-flash", effort = "max"}]\n')
        v_rich_allow = " ".join(vs or [])
        tooth("богатая форма: вне допуска -> правило-1-допуск",
              reason is None and vs
              and any("правило-1-допуск" in x for x in vs)
              and "glm-5.3-flash" in v_rich_allow
              and not any("семейство-не-определено" in x for x in vs),
              f"reason={reason} violations={vs}")

        reason, vs, _, _, _ = check(
            '[failover.class.exec-0n]\n'
            'models = [{model = "grok-4.6", effort = "high"}]\n')
        v_rich_eff = " ".join(vs or [])
        tooth("богатая форма: эффорт вне pins -> правило-3-эффорт со списком",
              reason is None and vs
              and any("правило-3-эффорт" in x for x in vs)
              and "grok-4.6" in v_rich_eff and "high" in v_rich_eff
              and "medium" in v_rich_eff and "max" in v_rich_eff,
              f"reason={reason} violations={vs}")

        reason, vs, l, r, _ = check(
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
        reason, vs, _, _, _ = check(
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
            reason, vs, _, _, _ = check(text7)
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

        reason, vs, _, _, _ = check(
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
        reason, vs, l, r, er = check(
            '[failover.class.exec-0n]\n'
            'models = ["grok-4.6", {model = "glm-5.3", effort = "max"}]\n')
        tooth("счётчик ступеней с эффортом считает богатую ступень",
              reason is None and not vs and l == 1 and r == 2 and er == 1,
              f"reason={reason} violations={vs} ladders={l} rungs={r} с_эффортом={er}")

        # зуб 18 (находка критика F2): порядок «антропик раньше ключа» несущий
        # и обязан быть запинен, а не только объявлен в докстринге.
        reason, vs, _, _, _ = check(
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
        reason, vs, _, _, _ = check(
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
        vl0 = verdict_line("/р.toml", 20, 77, 0)
        tooth("вердикт при нуле ступеней с эффортом -> правило-3 НЕ ИЗМЕРЕНО",
              "правило-3-эффорт НЕ ИЗМЕРЕНО" in vl0
              and "правило-3-эффорт — на всех" not in vl0
              and "77" in vl0,
              f"строка={vl0!r}")
        vl1 = verdict_line("/р.toml", 20, 77, 5)
        tooth("вердикт при ненуле -> правило-3 названо со своим знаменателем",
              "правило-3-эффорт — на всех 5" in vl1
              and "НЕ ИЗМЕРЕНО" not in vl1,
              f"строка={vl1!r}")

        main_root = os.path.join(work, "main-root")
        main_home = os.path.join(work, "main-home")
        main_table = os.path.join(main_root, "hooks", "routing-table.toml")

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
        with open(table_valid, encoding="utf-8") as src, open(
                main_table, "w", encoding="utf-8") as dst:
            dst.write(src.read())

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
        bad_rungs = reg('[failover.class.exec-0n]\n'
                        'models = ["glm-5.3-flash", "opus"]\n')
        expected_violations = (
            "НАРУШЕНИЕ правило-1-допуск: клетка exec-0n, ступень glm-5.3-flash — "
            "вне допуска клетки: нет в [classes.exec-0n].allowed "
            "(hooks/routing-table.toml)\n"
            "НАРУШЕНИЕ правило-2-антропик: клетка exec-0n, ступень opus — "
            "Anthropic-носитель в лестнице запрещён: автоматический переход "
            "на него обошёл бы маркер [anthropic-exception:…] молча\n"
        )
        main_tooth(6, "нарушения отдельными строками",
                   capture_main(["--registry", bad_rungs]),
                   (1, expected_violations, ""))
        empty = reg('[probe.x]\ny = 1\n')
        main_tooth(7, "пустой предмет не измерен",
                   capture_main(["--registry", empty]),
                   (3, f"НЕ ИЗМЕРЕНО: в реестре {empty} не разобрано ни одной "
                    "таблицы [failover.*] — пустой результат без предмета нулём "
                    "не считается\n", ""))
        valid = reg('[failover.class.exec-0n]\n'
                    'models = [{model = "glm-5.3", effort = "max"}]\n')
        main_tooth(8, "зелёный итог",
                   capture_main([], env={ENV_REGISTRY_VAR: valid}),
                   (0, verdict_line(valid, 1, 1, 1) + "\n", ""))

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

    reason, violations, ladders, rungs, effort_rungs = check_ladders(
        registry_path, table_path)
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
    print(verdict_line(registry_path, ladders, rungs, effort_rungs))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
