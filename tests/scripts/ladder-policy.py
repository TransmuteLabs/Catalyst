#!/usr/bin/env python3
"""Статический прибор политики лестниц замены модели (failover).

Предмет: таблицы [failover.class.<id>] в реестре проб probes.toml против
допуска клеток [classes.<id>].allowed в hooks/routing-table.toml. Мод
(plugins/catalyst-probes/hooks/register.ts) routing-table.toml НЕ читает
нигде, а гейт диспатча срабатывает на вызове инструмента, тогда как лестница
меняет модель уже ПОСЛЕ него и вторым вызовом не проверяется -- поэтому
проверка обязана быть внешней и статической. Два правила (бриф #225,
адъюдикация контроллера 2026-09-16):

  правило-1-допуск: каждая ступень каждой [failover.class.<id>] обязана быть
    в [classes.<id>].allowed. Класса нет в таблице -- нарушение с названной
    клеткой, не тихий пропуск.
  правило-2-антропик: ни одна ступень не смеет быть Anthropic-носителем:
    автоматический переход на него обошёл бы маркер [anthropic-exception:…]
    молча. Признак -- по объявленным ниже семействам; имя, не опознанное НИ
    одним семейством, -- нарушение «семейство не определено»: слепота
    прибора обязана быть слышна, иначе новая модель молча выключит правило.

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


def rung_violation(cell, rung, allowed):
    """Строка-нарушение для одной ступени или None.

    Порядок правил фиксирован: семейство -> антропик -> допуск; на ступень
    сообщается первое совпадение, поэтому зубы изолированы друг от друга.
    Допуск сверяется ТОЧНО (сетка матчит allowed дословно), семейства -- по
    префиксам без регистра.
    """
    name = str(rung).strip()
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
    return None


def check_ladders(registry_path, table_path):
    """(reason, violations, ladders, rungs).

    reason None -- предмет измерим: violations -- список строк-нарушений
    (пустой = правила соблюдены), ladders -- число разобранных таблиц
    [failover.class.*], rungs -- число ступеней в них. reason не None --
    прибор не в состоянии мерить (код 2).
    """
    reg, err = load_toml(registry_path)
    if err is not None:
        return f"реестр: {err}", None, None, None
    tab, err = load_toml(table_path)
    if err is not None:
        return f"таблица маршрутизации: {err}", None, None, None

    failover = reg.get("failover")
    if failover is None:
        return None, [], 0, 0
    if not isinstance(failover, dict):
        return (f"реестр {registry_path}: секция [failover] не таблица -- "
                "форма лестниц не разобрана"), None, None, None
    classes_map = failover.get("class")
    if classes_map is None:
        return None, [], 0, 0
    if not isinstance(classes_map, dict):
        return (f"реестр {registry_path}: секция [failover.class] не таблица -- "
                "форма лестниц не разобрана"), None, None, None
    grid = tab.get("classes", {})
    if not isinstance(grid, dict):
        return (f"таблица {table_path}: секция [classes] не таблица -- "
                "допуск клеток не разобран"), None, None, None

    violations = []
    ladders = 0
    rungs = 0
    for cell in classes_map:
        ladder = classes_map[cell]
        if not isinstance(ladder, dict):
            return (f"реестр {registry_path}: [failover.class.{cell}] не таблица -- "
                    "форма лестницы не разобрана"), None, None, None
        ladders += 1
        models = ladder.get("models", [])
        if not isinstance(models, list):
            return (f"реестр {registry_path}: [failover.class.{cell}].models не список -- "
                    "форма лестницы не разобрана"), None, None, None
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
                    "допуск клетки не разобран"), None, None, None
        for rung in models:
            rungs += 1
            v = rung_violation(cell, rung, allowed)
            if v is not None:
                violations.append(v)
    return None, violations, ladders, rungs


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
                    'allowed = ["glm-5.3", "grok-4.6", "opus", "madeup-9"]\n')

        def check(registry_text=None, registry_path=None, table_path=None):
            r = registry_path or reg(registry_text)
            t = table_path or table_valid
            return check_ladders(r, t)

        # зуб 0 (положительный контроль): валидная лестница -- 0 нарушений
        reason, vs, l, r = check(
            '[failover]\nenabled = true\n\n[failover.class.exec-0n]\n'
            'models = ["glm-5.3", "grok-4.6"]\n')
        tooth("положительный контроль: валидная лестница зелена",
              reason is None and not vs and l == 1 and r == 2,
              f"reason={reason} violations={vs} ladders={l} rungs={r}")

        # зуб 1: ступень вне допуска клетки -> нарушение правило-1-допуск,
        # названы клетка и ступень
        reason, vs, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "glm-5.3-flash"]\n')
        v1 = " ".join(vs)
        tooth("ступень вне допуска -> правило-1-допуск с клеткой и ступенью",
              reason is None and vs
              and any("правило-1-допуск" in x for x in vs)
              and "exec-0n" in v1 and "glm-5.3-flash" in v1,
              f"reason={reason} violations={vs}")

        # зуб 2: Anthropic-имя в лестнице -> правило-2-антропик
        reason, vs, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "opus"]\n')
        v2 = " ".join(vs)
        tooth("Anthropic-имя -> правило-2-антропик",
              reason is None and vs
              and any("правило-2-антропик" in x for x in vs)
              and "opus" in v2,
              f"reason={reason} violations={vs}")

        # зуб 3: имя, не опознанное ни одним семейством -> «семейство не
        # определено» (слепота прибора обязана быть слышна)
        reason, vs, _, _ = check(
            '[failover.class.exec-0n]\nmodels = ["glm-5.3", "madeup-9"]\n')
        v3 = " ".join(vs)
        tooth("неизвестное имя -> «семейство не определено»",
              reason is None and vs
              and any("семейство не определено" in x for x in vs)
              and "madeup-9" in v3,
              f"reason={reason} violations={vs}")

        # зуб 4: реестр без единой таблицы [failover.*] -> НОЛЬ лестниц
        # (это НЕ ИЗМЕРЕНО, код 3, а не зелёный)
        reason, vs, l, _ = check('[probe.x]\ny = 1\n')
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
        reason, vs, _, _ = check(registry_path=fake_reg)
        tooth("явный путь отсутствующего реестра -> отказ с названным путём",
              reason is not None and fake_reg in reason and vs is None,
              f"reason={reason}")

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


def main(argv):
    if "--self-check" in argv:
        return self_check()

    root = tool_root()
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
        registry_path, attempts, err = resolve_registry(root)
        if err is not None:
            print(f"ПРИБОР НЕДОСТУПЕН: {err}", file=sys.stderr)
            return 2
        if registry_path is None:
            print("ПРИБОР НЕДОСТУПЕН: реестр probes.toml не найден. "
                  "Искал по порядку:", file=sys.stderr)
            for label, path in attempts:
                print(f"  - {label}: {path}", file=sys.stderr)
            return 2

    reason, violations, ladders, rungs = check_ladders(registry_path, table_path)
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
    print(f"лестниц {ladders} (ступеней {rungs}), файл {registry_path}: "
          "правило-1-допуск и правило-2-антропик соблюдены на всех ступенях")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
