#!/usr/bin/env bash
# CONSTRAINT: один дом резолва бинарника стендов. Порядок — CLAUDE_BIN (пустое
# значение = не задан), затем `command -v claude`. Нет бинарника, каталог или
# неисполняемый файл — код 2 (ОТКАЗ ПРИБОРА), причина на stderr: код 3
# tests/run-all.sh не краснит только у стендов из OPTIN_STANDS, а резолв
# бинарника — не опт-ин. Найденный путь — абсолютный, на stdout, код 0:
# относительный CLAUDE_BIN не переживает смену каталога стендом. Копий этого
# порядка в стендах нет.

resolve_claude_bin() {
  local bin="${CLAUDE_BIN:-}" dir
  if [ -z "$bin" ]; then
    bin="$(command -v claude || true)"
  fi
  if [ -z "$bin" ]; then
    printf 'resolve_claude_bin: бинарник claude не найден (CLAUDE_BIN не задан или пуст, command -v claude пуст)\n' >&2
    return 2
  fi
  if [ ! -f "$bin" ] || [ ! -x "$bin" ]; then
    printf 'resolve_claude_bin: бинарник claude — не исполняемый файл: %s\n' "$bin" >&2
    return 2
  fi
  case "$bin" in
    /*) ;;
    *)
      dir="$(cd "$(dirname -- "$bin")" && pwd -P)" || {
        printf 'resolve_claude_bin: каталог бинарника не открывается: %s\n' "$bin" >&2
        return 2
      }
      bin="$dir/$(basename -- "$bin")"
      ;;
  esac
  printf '%s\n' "$bin"
  return 0
}
