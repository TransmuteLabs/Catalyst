#!/usr/bin/env bash
# Пуш и активация плагина -- ОДИН шаг.
#
# Зачем. Измерено 2026-09-15 (#188): реестр установки держал
# catalyst-probes@catalyst на версии позади кэша и клона маркетплейса --
# `claude plugin update` сверяет ОБЪЯВЛЕННУЮ version, поэтому всё, что было
# закоммичено и запушено, в бою не исполнялось ни разу, и ни одна дверь этого
# не назвала. Этот инструмент закрывает шаг: убедиться, что пушить нечего,
# обновить зеркало, активировать -- и ДОКАЗАТЬ активацию сверкой реестра
# с деревом.
#
# CONSTRAINT: сам инструмент НЕ пушит -- «пушить нечего» обязано быть
# ПРОВЕРЕНО (НЕ_ЗАПУШЕНО), иначе зеркало тянет с origin и активация взяла бы
# прошлую версию.
#
# CONSTRAINT: ручка отказа от сверки НЕ заводится ни в каком виде:
# CLAUDE_BIN и PLUGINS_REGISTRY существуют только для синтетического стенда,
# в бою -- умолчания. Инструмент, у которого можно выключить доказательство,
# доказательством не является.
#
# CONSTRAINT: работает в ТЕКУЩЕМ репозитории (cwd), как .githooks/pre-commit.
#
# Коды возврата: 0 -- активация доказана; 1 -- названный отказ;
# 2 -- прибор недоступен (мерить нечем).
set -u

PLUGIN="${1:-catalyst-probes}"
MARKETPLACE="${2:-catalyst}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
PLUGINS_REGISTRY="${PLUGINS_REGISTRY:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json}"

refuse() { printf 'ship-plugin: ОТКАЗ %s\n' "$1" >&2; exit 1; }
no_instrument() { printf 'ship-plugin: ПРИБОР НЕДОСТУПЕН: %s\n' "$1" >&2; exit 2; }

manifest_version() {   # <файл> -> version; ненулевой rc -- не читается
  python3 -c 'import json,sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])
except Exception:
    sys.exit(1)' "$1"
}

registry_version() {   # -> version записи; rc=1 реестр не читается, rc=2 записи нет
  python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as exc:
    print("реестр не читается: %s" % exc); sys.exit(1)
entries = (d.get("plugins") or {}).get(sys.argv[2]) or []
if not entries or not entries[0].get("version"):
    print("в реестре нет записи %s -- нечего сверять" % sys.argv[2]); sys.exit(2)
print(entries[0]["version"])' "$PLUGINS_REGISTRY" "$PLUGIN@$MARKETPLACE"
}

manifest_name() {   # <файл> -> name; ненулевой rc -- не читается
  python3 -c 'import json,sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8"))["name"])
except Exception:
    sys.exit(1)' "$1"
}

# --- дом плагина и версия ДЕРЕВА ----------------------------------------------
# CONSTRAINT: дом выбирается ПОЛЕМ name корневого манифеста, не наличием файла:
# при обратной схеме опечатка в имени (catalist) молча разрешилась бы корневым
# плагином и отгрузила бы НЕ ТО. Нечитаемый корневой манифест -- не отказ:
# просто дом не корневой, идём вложенной дорогой.
ROOT_MANIFEST=".claude-plugin/plugin.json"
HOME_DIR="plugins/$PLUGIN"
MANIFEST="plugins/$PLUGIN/.claude-plugin/plugin.json"
if root_name=$(manifest_name "$ROOT_MANIFEST") && [ "$root_name" = "$PLUGIN" ]; then
  HOME_DIR="."
  MANIFEST="$ROOT_MANIFEST"
fi
[ -f "$MANIFEST" ] || no_instrument "нет ни корневого $ROOT_MANIFEST (name не $PLUGIN либо не читается), ни вложенного $MANIFEST -- версию дерева не прочитать"
TREE_V=$(manifest_version "$MANIFEST") || no_instrument "$MANIFEST не разбирается как JSON"

# --- активировать несохранённое нельзя ----------------------------------------
# CONSTRAINT: область грязи следует за домом; для корневого -- ровно канон
# владения .githooks/pre-commit. Голый `git status --porcelain` без pathspec
# ЗАПРЕЩЁН: грязь в tests/ или docs/ не принадлежит корневому плагину, отказ
# по ней стрелял бы шире области действия.
if [ "$HOME_DIR" = "." ]; then
  DIRTY=$(git status --porcelain -- \
    skills agents commands hooks .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin) \
    || no_instrument "git status отказал -- текущий каталог не репозиторий?"
  if [ -n "$DIRTY" ]; then
    refuse "ДЕРЕВО_ГРЯЗНОЕ: по путям корневого плагина $PLUGIN (skills agents commands hooks .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin) не всё сохранено:
$DIRTY"
  fi
else
  DIRTY=$(git status --porcelain -- "plugins/$PLUGIN") \
    || no_instrument "git status отказал -- текущий каталог не репозиторий?"
  if [ -n "$DIRTY" ]; then
    refuse "ДЕРЕВО_ГРЯЗНОЕ: по путям plugins/$PLUGIN не всё сохранено:
$DIRTY"
  fi
fi

# --- HEAD обязан быть запушен --------------------------------------------------
BRANCH=$(git rev-parse --abbrev-ref HEAD) || no_instrument "git rev-parse отказал"
AHEAD=$(git log --oneline "origin/$BRANCH..HEAD" 2>&1)
if [ $? -ne 0 ] || [ -n "$AHEAD" ]; then
  # Ровно тот корень #188: зеркало маркетплейса тянет с origin, активация
  # непушеного HEAD взяла бы ПРОШЛУЮ версию и сверка это поймала бы позже --
  # здесь отказ раньше и с названной причиной.
  refuse "НЕ_ЗАПУШЕНО: HEAD впереди origin/$BRANCH (зеркало тянет с origin -- активация взяла бы прошлую версию):
$AHEAD"
fi

# --- зеркала корневого обязаны согласоваться ДО отгрузки ----------------------
# CONSTRAINT: зеркала читают ЧУЖИЕ инструменты (клоны маркетплейса других
# площадок) -- расщеплённое объявление отгружать нельзя; pre-commit обходится
# --no-verify, эта дверь стоит при самой отгрузке. Отсутствующий файл зеркала --
# тоже расхождение.
if [ "$HOME_DIR" = "." ]; then
  MIRRORS=".claude-plugin/plugin.json .codex-plugin/plugin.json .cursor-plugin/plugin.json .kimi-plugin/plugin.json"
  first=""; diverged=0; listing=""
  for m in $MIRRORS; do
    v=$(manifest_version "$m") || v="НЕТ ФАЙЛА"
    [ -n "$first" ] || first="$v"
    [ "$v" = "$first" ] || diverged=1
    listing="$listing
  $m → $v"
  done
  [ "$diverged" = 0 ] || refuse "ЗЕРКАЛА_РАСХОДЯТСЯ:$listing"
fi

# --- обновление зеркала маркетплейса ------------------------------------------
OUT=$("$CLAUDE_BIN" plugin marketplace update "$MARKETPLACE" 2>&1)
RC=$?
if [ "$RC" -ne 0 ]; then
  refuse "ОБНОВЛЕНИЕ_МАРКЕТПЛЕЙСА_ОТКАЗАЛО: $CLAUDE_BIN plugin marketplace update $MARKETPLACE вернул код $RC:
$OUT"
fi

# --- активация -----------------------------------------------------------------
OUT=$("$CLAUDE_BIN" plugin update "$PLUGIN@$MARKETPLACE" 2>&1)
RC=$?
if [ "$RC" -ne 0 ]; then
  # CONSTRAINT: причина обязана отличаться от шага маркетплейса -- два шага
  # не имеют права быть неразличимыми в отказе.
  refuse "ОБНОВЛЕНИЕ_ПЛАГИНА_ОТКАЗАЛО: $CLAUDE_BIN plugin update $PLUGIN@$MARKETPLACE вернул код $RC:
$OUT"
fi

# --- сверка: реестр против дерева ----------------------------------------------
REG_V=$(registry_version 2>&1)
RC=$?
[ "$RC" -eq 0 ] || no_instrument "$REG_V"
if [ "$REG_V" = "$TREE_V" ]; then
  printf 'в бою %s v%s (дерево v%s)\n' "$PLUGIN" "$REG_V" "$TREE_V"
  exit 0
fi
refuse "АКТИВАЦИЯ_НЕ_ПЕРЕСТАВИЛА: реестр v$REG_V, дерево v$TREE_V"
