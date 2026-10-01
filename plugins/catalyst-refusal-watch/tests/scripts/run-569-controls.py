#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

REGISTER = 'hooks/register.ts'
SUITE = 'tests/sec-default-569.test.ts'
PARITY = 'tests/scripts/check-splice-parity.sh'


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise ValueError('mutation premise count=' + str(text.count(old)) + ' expected=' + str(count) + ': ' + old)
    return text.replace(old, new)


# CONSTRAINT: every control changes one predicate or one coherent registration shape, in an isolated copy.
MUTATIONS = {}
def mutation(name, old, new, tooth, message, file=REGISTER, count=1):
    MUTATIONS[name] = (file, lambda text: replace(text, old, new, count), tooth, message)

mutation('rule-byte', 'Если ответ был остановлен', 'Если ответ Был остановлен', 'byte-parity RULE_TEXT UTF-8', 'byte-parity: complete UTF-8 literal')
mutation('pin-byte', 'export const RULE_TEXT_SPLICE_SHA256 = "4d', 'export const RULE_TEXT_SPLICE_SHA256 = "5d', 'byte-parity RULE_TEXT UTF-8', 'byte-parity: module declares')
mutation('env-true', 'if (["1", "true", "yes", "on"].includes(value)) return true', 'return true', 'env-off-569 0', 'env-off-569: disabled switch')
mutation('env-false', 'if (["1", "true", "yes", "on"].includes(value)) return true', 'if (false) return true', 'env-on-569 on', 'env-on-569: explicit on')
mutation('env-unset-on', 'String(raw ?? "")', 'String(raw ?? "on")', 'env-unset-569', 'env-unset-569: absent switch')
mutation('env-diagnostic', 'await diagnose569($, state, "env", "[569] " + MOD_NAME + ": неизвестное значение CLAUDE_REFUSAL_WATCH=" + raw569(raw), undefined, "value")', 'void value', 'env-unknown-569', 'env-unknown-569: named diagnostic')
mutation('passport-applied', 'record.step26?.applied !== true || ', '', 'passport-reader unapplied', 'passport-reader: unapplied must not suppress')
mutation('passport-hash', ' || record.step26?.rule_sha256 !== RULE_TEXT_SPLICE_SHA256', '', 'passport-reader hash', 'passport-reader: hash must not suppress')
mutation('passport-version', 'record?.version !== version || ', '', 'passport-reader version', 'passport-reader: version must not suppress')
mutation('passport-platform', ' || record?.platform !== platform', '', 'passport-platform-mismatch R9', 'passport-platform-mismatch: fallback')
mutation('passport-size', 'stat.size !== record.size || ', '', 'passport-stale size', 'passport-stale: size mismatch')
MTIME = '!(Math.abs(stat.mtimeMs - record.mtime_ms) <= 1)'
NUMERIC = '!Number.isSafeInteger(record.size) || record.size < 0 || !Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isFinite(record.mtime_ms) || !Number.isFinite(stat.mtimeMs)'
STAT = 'if (stat.kind !== "file" || stat.size !== record.size || ' + NUMERIC + ' || ' + MTIME + ') {'
mutation('passport-mtime', ' || ' + MTIME, '', 'passport-stale mtime', 'passport-stale: mtime mismatch')
mutation('passport-no-stat', 'await $.fs.stat(root + "/.local/share/claude/versions/" + version)', '({ kind: "file", size: record.size, mtimeMs: record.mtime_ms })', 'passport-reader valid and cached', 'passport-reader: only canonical file')
mutation('passport-stale-skip', STAT, STAT + ' state.passportCovered = true', 'passport-stale size', 'passport-stale: size mismatch')
mutation('canonical-missing-skip', 'if (!absent569(x)) throw x', 'if (!absent569(x)) throw x\n      state.passportCovered = true', 'passport-canonical-missing R8', 'passport-canonical-missing: fallback')
missing = '      await diagnose569($, state, "passport-stale", "[569] passport-stale " + raw569(version), x)\n      return\n    }\n    if (!current569(state)) return'
mutation('canonical-missing-diagnostic', missing, '      return\n    }\n    if (!current569(state)) return', 'passport-canonical-missing R8', 'passport-canonical-missing: one stale')
mutation('passport-read-diagnostic', 'await diagnose569($, state, "passport-read", "[569] " + MOD_NAME + ": passport-read " + raw569(version) + ": " + error569(x), x)', 'void x', 'passport-read-error unreadable', 'passport-read-error: named diagnostic')
mutation('passport-recontext', 'const src = Array.isArray(r?.blocks) ? r.blocks : []', 'await passport569($, state)\n      const src = Array.isArray(r?.blocks) ? r.blocks : []', 'passport-reader valid and cached', 'passport-reader: version read once')
mutation('passport-reend', '    __reset()\n    return next(e)', '    await passport569($, state)\n    __reset()\n    return next(e)', 'module-clear-retains R7a', 'module-clear-retains: passport is retained')
mutation('passport-first-ambiguous', 'if (names.length > 1)', 'if (false)', 'passport-ambiguous R9', 'passport-ambiguous: never chooses first')
mutation('passport-fuzzy-name', 'name.startsWith(prefix) && /^[a-z0-9_]+\\.json$/.test(name.slice(prefix.length))', 'name.includes(version)', 'passport-name-exact R9', 'passport-name-exact: no wrong file read')
mutation('passport-skip-removed', '!state.passportCovered && !canonical', '!canonical', 'passport-reader valid and cached', 'passport-reader: valid passport suppresses')
mutation('local-name-only', 'typeof b?.text === "string" && b.text.indexOf(RULE_TEXT) !== -1', 'b?.name === "refusalHandling"', 'refusal-idempotent stale and duplicates', 'refusal-idempotent: stale text is not canonical')
mutation('local-skip-removed', 'const insert = enabled && !state.passportCovered && !canonical', 'const insert = enabled && !state.passportCovered', 'refusal-idempotent full literal in another block', 'refusal-idempotent: full literal in any block')
mutation('local-first-phrase', 'b.text.indexOf(RULE_TEXT) !== -1', 'b.text.indexOf(RULE_TEXT.slice(0, 30)) !== -1', 'refusal-idempotent stale and duplicates', 'refusal-idempotent: stale text is not canonical', count=2)
mutation('duplicate-cleanup-removed', 'if (!placed) {', 'if (true) {', 'refusal-idempotent stale and duplicates', 'refusal-idempotent: duplicate own names')
mutation('duplicate-first-own', 'own.find((b: any) => typeof b.text === "string" && b.text.indexOf(RULE_TEXT) !== -1) ?? own[0]', 'own[0]', 'refusal-idempotent canonical duplicate after stale', 'refusal-idempotent: first canonical occupies')
mutation('probe-foreign-origin', ' && next.origin?.plugin === MOD_NAME', '', 'seat-probe-shape ignores foreign origin', 'seat-probe-shape: foreign read cannot mask')
mutation('probe-not-awaited', 'await $.settings.read()', 'void $.settings.read()', 'seat-probe-causality pending read', 'seat-probe-causality: pending read is not seating')
mutation('probe-rejected-seated', '"[569] " + MOD_NAME + ": доставка не подтверждена наблюдением: " + error569(x)', '"[569] " + MOD_NAME + ": user tier обойдён организационным sec-default"', 'seat-probe-causality rejected read', 'seat-probe-causality: refusal is unconfirmed')
mutation('d4-covered-lost', 'const uncovered = state.passportCovered ? "нет" : "RULE_TEXT (prompt.context)"', 'const uncovered = "RULE_TEXT (prompt.context)"', 'delivery-observation-569 covered', 'delivery-observation-569: covered rule is not called lost')
mutation('d4-no-latch', '  state.diagnosed.add(latch)', '  void latch', 'delivery-observation-569 logThrows', 'delivery-observation-569: latch is set before channel')
mutation('d4-late-latch', '  state.diagnosed.add(latch)\n  try {\n    await $.ui.log(text)', '  try {\n    await $.ui.log(text)\n    state.diagnosed.add(latch)', 'delivery-observation-569 logRejects', 'delivery-observation-569: latch is set before channel')
mutation('errno-path-regex', 'return errno569(x) === "ENOENT"', r'return /\bENOENT\b/.test(strOf(x?.code ?? "") + " " + strOf(x?.message ?? x))', 'errno-path-569 EACCES', 'errno-path-569: EACCES is not path ENOENT')
mutation('window-guard-removed', ' && state.seatProbePending', '', 'seat-probe-shape ignores outside window', 'seat-probe-shape: outside-window after start cannot change state')
mutation('version-guard-removed', r'if (typeof version !== "string" || !version || version === "." || version === ".." || /[\/\x00-\x1f\x7f-\x9f]/.test(version)) throw new OwnMessage569("invalid version segment")', '', 'version-segment-569 ".."', 'version-segment-569: invalid version is diagnosed')
mutation('mtime-strict', MTIME, 'stat.mtimeMs !== record.mtime_ms', 'mtime-tolerance-569 0.4', 'mtime-tolerance-569: one millisecond boundary')
mutation('mtime-bound-removed', MTIME, 'false', 'mtime-tolerance-569 1.01', 'mtime-tolerance-569: one millisecond boundary')
mutation('kind-guard-removed', 'stat.kind !== "file" || ', '', 'canonical-kind-569 other', 'canonical-kind-569: non-file keeps fallback')
mutation('suppressed-stale-own-kept', 'if (insert || (typeof kept?.text === "string" && kept.text.indexOf(RULE_TEXT) !== -1)) blocks.push', 'blocks.push', 'stale-own-external-canon-569', 'stale-own-external-canon-569: stale own removed')
mutation('env-off-transparency-removed', 'if (!current569(state) || !enabled) return r', 'if (!current569(state)) return r', 'env-off-transparent-569', 'env-off-transparent-569: off keeps original array')
mutation('reason-class-removed', 'const latch = key + ":" + reason', 'const latch = key', 'diagnostic-causes-569', 'diagnostic-causes-569: distinct reasons twice, repeated reason once')
mutation('raw-env-normalized', 'raw569(raw)', 'JSON.stringify(value).slice(0, 80)', 'env-raw-diagnostic-569', 'env-raw-diagnostic-569: diagnostic preserves raw spelling')
mutation('late-d4-removed', '      if (current569(state)) await delivery569($, state, enabled)', '      void enabled', 'dynamic-d4-569', 'dynamic-d4-569: enabling cached seated emits once')
for name, reset in [('clear-latch', 'state.diagnosed.clear()'), ('clear-passport', 'state.passportCovered = false'), ('clear-verdict', 'state.seatProbeResult = "unknown"'), ('clear-generation', 'state.generation = ++moduleGeneration'), ('clear-started', 'state.started = false')]:
    mutation(name, '    __reset()\n    return next(e)', '    ' + reset + '\n    __reset()\n    return next(e)', 'module-state-retains R7a', 'module-state-retains: clear retains')
mutation('reload-no-generation', 'generation: ++moduleGeneration', 'generation: moduleGeneration', 'module-reload-reprobes R7b', 'module-reload-reprobes: fresh register advances')
mutation('reload-retains-state', 'const state: Environment569 = {', 'const state: Environment569 = snapshotState569 ?? {', 'module-reload-reprobes R7b', 'module-reload-reprobes: fresh register advances')
mutation('prepend-next', 'next.to(e, "append")', 'next(e)', 'seated-native-chain-569 seated', 'seated-native-chain-569: user sentinel tier delivery', file=SUITE, count=6)
mutation('loader-root-relative', './register.ts', './hooks/register.ts', 'fixture-loader-285', '(path-not-found)', file='hooks/hooks.json')


def old_await(text):
    text = replace(text, 'return state.generation === moduleGeneration', 'return true')
    return replace(text, 'if (generation !== moduleGeneration) return next(e)', 'if (false) return next(e)', 6)
MUTATIONS['old-await-no-generation'] = (REGISTER, old_await, 'module-old-await R7c', 'module-old-await: stale generation cannot diagnose')


def merged(text):
    begin = text.index('  on("settings.read", ($: any, e: any, next: any) => {')
    end = text.index('    const generation = state.generation', begin)
    replacement = '''  on("!turn.step", async ($: any, e: any, next: any) => {
    if (next.event === "settings.read") {
      if (current569(state) && state.seatProbePending && next.origin?.plugin === MOD_NAME) state.seatProbeSeen = true
      return next(e)
    }
    if (next.event !== "session.start") return next(e)
'''
    return text[:begin] + replacement + text[end:]
MUTATIONS['probe-merged-registration'] = (REGISTER, merged, 'seated-native-chain-569 unseated', 'seated-native-chain-569: one seated diagnostic, no unseated diagnostic')


def stream_clone(text):
    return replace(text, '      result = yield* observed(', '      result = yield* (async function* () { for await (const chunk of observed(').replace('''        (value) => {
          finalValue = value
        },
      )''', '''        (value) => {
          finalValue = value
        },
      )) yield { ...chunk } })()''', 1)
MUTATIONS['stream-chunk-clone'] = (REGISTER, stream_clone, 'T3 chunks and result are the same objects', 'toBe')
mutation('stream-result-clone', '    return result\n  })', '    return { ...result }\n  })', 'T3 chunks and result are the same objects', 'toBe')


mutation('numeric-record-mtime', '!Number.isFinite(record.mtime_ms) || ', '', 'passport-numeric-569 string-mtime', 'passport-numeric-569: malformed numeric fields never cover')
mutation('numeric-stat-mtime', '!Number.isFinite(stat.mtimeMs) || ', '', 'passport-numeric-569 string-stat-mtime', 'passport-numeric-569: malformed numeric fields never cover')
def integer_size_removed(text):
    text = replace(text, '!Number.isSafeInteger(record.size) || ', '')
    return replace(text, '!Number.isSafeInteger(stat.size) || ', '')
MUTATIONS['integer-record-size'] = (REGISTER, integer_size_removed, 'passport-numeric-569 fraction-size', 'passport-numeric-569: malformed numeric fields never cover')
mutation('string-size-normalized', 'const record = JSON.parse(raw)', 'const record = JSON.parse(raw); record.size = Number(record.size)', 'passport-numeric-569 string-size', 'passport-numeric-569: malformed numeric fields never cover')
mutation('nonfinite-stat-normalized', 'await $.fs.stat(root + "/.local/share/claude/versions/" + version)', 'await $.fs.stat(root + "/.local/share/claude/versions/" + version).then((stat: any) => ({ ...stat, mtimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : record.mtime_ms }))', 'passport-numeric-569 infinite-stat-mtime', 'passport-numeric-569: malformed numeric fields never cover')
mutation('dynamic-unseated-d4', 'if (enabled && state.seatProbeResult === "seated")', 'if (enabled)', 'dynamic-d4-unseated-569', 'dynamic-d4-569: enabling cached seated emits once')
mutation('dynamic-start-latch', '  state.diagnosed.add(latch)', '  void latch', 'dynamic-d4-start-on-569', 'dynamic-d4-569: enabling cached seated emits once')
mutation('diagnostic-class-limit', ').length >= 8) reason = "other"', ').length >= Infinity) reason = "other"', 'diagnostic-class-bound-569', 'diagnostic-class-bound-569: at most eight classes plus other')
mutation('errno-long-code', '/^E[A-Z0-9]{1,15}$/.test(x.code) ? x.code : null', 'x.code', 'diagnostic-long-class-569 code', 'diagnostic-long-class-569: long token maps to error')
mutation('errno-long-message', 'E[A-Z0-9]{1,15})', 'E[A-Z0-9]+)', 'diagnostic-long-class-569 message', 'diagnostic-long-class-569: long token maps to error')
mutation('raw-serialized-slice', 'JSON.stringify(points.slice(0, 80).join(""))', 'JSON.stringify(strOf(value)).slice(0, 80)', 'raw-codepoints-569 emoji', 'raw-codepoints-569: serialize complete clipped codepoints')
mutation('version-unbounded', 'raw569(version)', 'version', 'version-log-bound-569 read', 'version-log-bound-569: version log bounded to 200', count=4)
mutation('version-c1-allowed', r'/[\/\x00-\x1f\x7f-\x9f]/.test(version)', r'/[\/\x00-\x1f\x7f]/.test(version)', 'version-c1-569', 'version-c1-569: C1 version diagnosed')

for site, fragment in [
    ('debug', ': канал " + key + " не сработал: '),
    ('env', ': отказ чтения CLAUDE_REFUSAL_WATCH: '),
    ('passport-read', ': passport-read " + raw569(version) + ": '),
    ('D4', ': доставка не подтверждена наблюдением: '),
]:
    old = fragment + '" + error569(x)'
    mutation('error-text-' + site, old, fragment + '" + strOf(x?.message ?? x)', 'error-raw-569 ' + site, 'error-raw-569: controls escaped at ' + site)
mutation('error-text-channel', 'why = error569(x)', 'why = strOf((x as any)?.message ?? x)', 'error-raw-569 channel', 'error-raw-569: controls escaped at channel')
mutation('own-error-clipped', 'if (x instanceof OwnMessage569) return x.message', 'if (false) return x.message', 'own-error-text-569', 'own-error-text-569: complete own message reaches store log')

ESCAPE = r'quoted.replace(/[\x7f-\x9f\u{2028}\u{2029}\p{Cf}]/gu, escapeUnit569)'
mutation('raw-control-escape', ESCAPE, 'quoted', 'raw-del-c1-separators-569', 'raw-del-c1-separators-569: lowercase escapes in raw values')
mutation('raw-cf-escape', ESCAPE, r'quoted.replace(/[\x7f-\x9f\u{2028}\u{2029}]/gu, escapeUnit569)', 'raw-cf-569', 'raw-cf-569: format characters escaped with round-trip')

mutation('ui-model-raw', '"⚠ Ответ оборван фильтром сервиса · " + raw569(info.model)', '"⚠ Ответ оборван фильтром сервиса · " + strOf(info.model)', 'ui-raw-569 model', 'ui-raw-569: model escaped in toast')
mutation('ui-status-model-raw', '" " + raw569(info.model)', '" " + strOf(info.model)', 'ui-raw-569 model', 'ui-raw-569: model escaped in status')
mutation('ui-agent-raw', 'raw569(info.agentId)', 'strOf(info.agentId)', 'ui-raw-569 agentId', 'ui-raw-569: agentId escaped in toast', count=3)
mutation('ui-tools-raw', 'info.tools.map(raw569)', 'info.tools.map(strOf)', 'ui-raw-569 tools', 'ui-raw-569: tool names escaped in toast')
mutation('ui-category-raw', '" · категория " + raw569(info.category)', '" · категория " + strOf(info.category)', 'ui-raw-569 category', 'ui-raw-569: category escaped in toast')
mutation('ui-taskid-raw', 'raw569(info.taskId)', 'strOf(info.taskId)', 'ui-raw-569 taskId', 'ui-raw-569: taskId escaped in toast')
mutation('ui-turn-raw', '"turn " + raw569(info.turnId)', '"turn " + strOf(info.turnId)', 'ui-raw-569 turnId', 'ui-raw-569: turnId escaped in transcript log')
mutation('ui-step-raw', '"step " + raw569(info.step)', '"step " + strOf(info.step)', 'ui-raw-569 step', 'ui-raw-569: step escaped in transcript log')


def errno_guard_removed(text):
    text = replace(text, 'function errno569(x: any): string | null {\n  try {\n', 'function errno569(x: any): string | null {\n')
    return replace(text, '?.[1] ?? null\n  } catch {\n    return null\n  }\n}', '?.[1] ?? null\n}')
MUTATIONS['errno-getter-unguarded'] = (REGISTER, errno_guard_removed, 'unreadable-569 env getter', 'unreadable-569: unreadable exception named')


def error_guard_removed(text):
    text = replace(text, 'function error569(x: any): string {\n  try {\n    if (x instanceof OwnMessage569) return x.message\n', 'function error569(x: any): string {\n  if (x instanceof OwnMessage569) return x.message\n')
    return replace(text, '    return raw569(x?.message ?? x)\n  } catch {\n    // CONSTRAINT: бросок чтения чужого исключения — собственный литерал в OwnMessage569, не наружу.\n    return new OwnMessage569("<unreadable exception>").message\n  }\n}', '  return raw569(x?.message ?? x)\n}')
MUTATIONS['error-getter-unguarded'] = (REGISTER, error_guard_removed, 'unreadable-569 env getter', 'unreadable-569: unreadable exception named')
mutation('instanceof-unguarded', 'function error569(x: any): string {\n  try {\n    if (x instanceof OwnMessage569) return x.message', 'function error569(x: any): string {\n  if (x instanceof OwnMessage569) return x.message\n  try {', 'unreadable-569 env revoked', 'unreadable-569: unreadable exception named')
mutation('session-next-twice', '    return next(e)\n  })\n\n  on("turn.start"', '    await next(e)\n    return next(e)\n  })\n\n  on("turn.start"', 'unreadable-569 env getter', 'unreadable-569: next exactly once')

def nonnegative_removed(text):
    text = replace(text, 'record.size < 0 || ', '')
    return replace(text, 'stat.size < 0 || ', '')
MUTATIONS['size-nonnegative'] = (REGISTER, nonnegative_removed, 'passport-size-range-569 -1', 'passport-size-range-569: invalid size never covers')
mutation('size-safe-integer', 'Number.isSafeInteger(', 'Number.isInteger(', 'passport-size-range-569 9007199254740992', 'passport-size-range-569: invalid size never covers', count=2)
mutation('turn-next-before', 'on("turn.start", async ($: any, e: any, next: any) => {\n    if (!current569(state)) return next(e)', 'on("turn.start", async ($: any, e: any, next: any) => {\n    if (!current569(state)) return e', 'turn-next-function-569 stale-before', 'turn-next-function-569: next once at stale-before')
mutation('turn-next-await', '    if (!current569(state)) return next(e)\n    return next(e)\n  })', '    if (!current569(state)) return e\n    return next(e)\n  })', 'turn-next-function-569 stale-await', 'turn-next-function-569: next once at stale-await')
mutation('turn-next-env', '    if (!current569(state)) return next(e)\n    return next(e)\n  })', '    if (!current569(state)) return next(e)\n    return e\n  })', 'turn-next-host-569 env-throw', 'turn-next-host-569: lower turn runs exactly once at env-throw')

PARITY_CONTROLS = {
    'parity-first-match': ('two-literals', '--first-match', None),
    'parity-read-outside': ('missing-mod', '--read-outside', None),
    'parity-good-mutant': ('good', '--mutate', 'reject-good'),
    'parity-single-quote-mutant': ('single-quote', '--mutate', 'reject-single-quote'),
    'parity-bad-byte-mutant': ('bad-byte', '--mutate', 'ignore-kit-bytes'),
    'parity-unreadable-kit-mutant': ('unreadable-kit', '--mutate', 'skip-kit-read'),
    'parity-destructured-mutant': ('destructured-object', '--mutate', 'ignore-destructured'),
    'parity-unsupported-mutant': ('typed-rule', '--mutate', 'unsupported-ambiguous'),
}
for tooth in ['nested-kit-object', 'nested-kit-array', 'nested-mod-object', 'nested-mod-array', 'nested-alone', 'nested-depth3', 'skip-comment-brackets']:
    PARITY_CONTROLS['parity-' + tooth] = (tooth, '--mutate', 'old-destructured-regex')
for tooth in ['skip-string-brackets', 'skip-template-brackets']:
    PARITY_CONTROLS['parity-' + tooth] = (tooth, '--mutate', 'force-destructured')
for tooth in ['line-comment-ls', 'line-comment-ps']:
    PARITY_CONTROLS['parity-' + tooth] = (tooth, '--mutate', 'line-comment-lf-only')
for tooth in ['regex-hole', 'regex-hole-mod', 'regex-in-interp']:
    PARITY_CONTROLS['parity-' + tooth] = (tooth, '--mutate', 'ignore-regex')
PARITY_CONTROLS['parity-division-newline'] = ('division-newline', '--mutate', 'regex-always')
PARITY_CONTROLS['parity-division-chain'] = ('division-chain', '--mutate', 'regex-always')
for control, tooth, shape in [
    ('parity-property-rule', 'slash-property-closed', 'ignore-property'),
    ('parity-postfix-rule', 'slash-increment-closed', 'split-postfix'),
    ('parity-block-rule', 'slash-block', 'ignore-stmt-close'),
    ('parity-header-rule', 'slash-header', 'ignore-header-close'),
    ('parity-regex-class-lineend', 'regex-class-ls-canon', 'ignore-regex-class-lineend'),
    ('parity-regex-escape-lineend', 'regex-escape-lf-canon', 'ignore-regex-escape-lineend'),
    ('parity-mismatched-bracket', 'mismatched-nested', 'ignore-mismatched-bracket'),
]:
    PARITY_CONTROLS[control] = (tooth, '--mutate', shape)

BINARY_FIX5_CONTROLS = {
    'binary-order-mutant': ('sha-before-version', 'version-before-sha'),
    'binary-term-mutant': ('signal-term', 'no-signal-handler'),
    'binary-hup-mutant': ('signal-hup', 'no-signal-handler'),
}
PARITY_CONTROLS['parity-unclosed-comment'] = ('unclosed-block-comment', '--mutate', 'ignore-unclosed-comment')
PARITY_CONTROLS['parity-unclosed-string'] = ('unclosed-string-double', '--mutate', 'ignore-unclosed-string')
PARITY_CONTROLS['parity-unclosed-string-single'] = ('unclosed-string-single', '--mutate', 'ignore-unclosed-string')
PARITY_CONTROLS['parity-unclosed-template'] = ('unclosed-template', '--mutate', 'ignore-unclosed-template')
PARITY_CONTROLS['parity-unclosed-template-interp'] = ('unclosed-template-interp', '--mutate', 'ignore-unclosed-template')
PARITY_CONTROLS['parity-unclosed-regex'] = ('unclosed-regex-lineend', '--mutate', 'ignore-unclosed-regex')
PARITY_CONTROLS['parity-unclosed-regex-eof'] = ('unclosed-regex-eof', '--mutate', 'ignore-unclosed-regex')
PARITY_CONTROLS['parity-unclosed-bracket'] = ('unclosed-bracket', '--mutate', 'ignore-unclosed-bracket')

RUNNER = 'tests/scripts/run-569-controls.py'
ORACLE = 'tests/scripts/oracle-569-fix5.py'
ORACLE_JS = 'tests/scripts/oracle-569-fix5.mjs'
BULK569 = 8000
CLEANUP_TEETH = {
    'cleanup-term-twice': (signal.SIGTERM, signal.SIGTERM),
    'cleanup-term-hup': (signal.SIGTERM, signal.SIGHUP),
    'cleanup-hup-inside': (None, signal.SIGHUP),
    'cleanup-int-inside': (None, signal.SIGINT),
    'cleanup-term-once': (signal.SIGTERM, None),
}
ORACLE_TEETH = ['oracle-kit-missing', 'oracle-current-green', 'oracle-kit-divergence', 'oracle-canon-outcome', 'oracle-tag-outcome']
DIVERGE = ("if (prev.type === 'punct' && prev.value === '}') return !!prev.stmtClose;", "if (prev.type === 'punct' && prev.value === '}') return false;")
TAG_SCANNER = ("    if stack:\n        kind = 'template' if stack[-1][0] == 'tpl' else 'template interpolation'\n        raise ValueError('unsupported literal: unclosed ' + kind)", '    if False:\n        pass')
# CONSTRAINT: the cleanup call is assembled, never spelled with its indentation here: binary-569-fix4.py drop-cleanup requires that spelling exactly once in this file.
CLEANUP_CALL = ' ' * 8 + 'cleanup569(root)\n'
LATCH_ON = ' ' * 8 + "LATCH569['on'] = True\n" + CLEANUP_CALL
RESTORE = "        for sig, handler in handlers.items():\n            signal.signal(sig, handler)\n"
# CONSTRAINT: teeth sets of earlier-wave mutations are frozen (OLD_* = FIX6c, FIX6D_* = FIX6d) except the FIX7 extensions declared in KB/ADJUDICATION-569-WF-FIX6e-DELTA.md Ж25; each new tooth gets its own mutation instead.
OLD_CLEANUP_TEETH = ['cleanup-term-twice', 'cleanup-term-hup', 'cleanup-hup-inside', 'cleanup-term-once']
OLD_LATCH_TEETH = ['latch-handler-unbuffered']
FIX6D_LATCH_TEETH = OLD_LATCH_TEETH + ['latch-handler-foreign-error', 'latch-rt-signal', 'latch-nested-lines']
FIX6_CONTROLS = {
    'cleanup-latch-mutant': (RUNNER, LATCH_ON, CLEANUP_CALL, OLD_CLEANUP_TEETH + ['cleanup-int-inside'], 'cleanup-term-twice', "residue=['check-env']"),
    'cleanup-restore-early-mutant': (RUNNER, LATCH_ON + RESTORE, RESTORE + LATCH_ON, OLD_CLEANUP_TEETH + ['cleanup-int-inside'], 'cleanup-term-twice', 'runner RC=-15'),
    'cleanup-first-code-mutant': (RUNNER, "        if LATCH569['caught']:\n            raise SystemExit(128 + LATCH569['caught'][0])\n", "        if LATCH569['caught']:\n            raise SystemExit(128 + LATCH569['caught'][-1])\n", list(OLD_CLEANUP_TEETH), 'cleanup-term-hup', 'runner RC=129'),
    'oracle-scope-skip-mutant': (RUNNER, "        if name == 'oracle-current':\n", "        if name == 'oracle-current':\n            continue\n", ORACLE_TEETH, 'oracle-kit-divergence', 'controls scopes=1 EXIT=0'),
    'oracle-outcome-unchecked-mutant': (ORACLE, 'held = measured.returncode == code and want in measured.stdout', 'held = True', ORACLE_TEETH, 'oracle-canon-outcome', 'runner RC=0'),
    'oracle-empty-tokens-mutant': (ORACLE_JS, "new Function(extracted + '\\nreturn lexModule;')()", "new Function(extracted + '\\nreturn () => ({ tokens: [], stateAt: () => \"code\" });')()", ORACLE_TEETH, 'oracle-current-green', 'oracle vacuous: kit-canon'),
}
LATCH_TEETH = ['latch-handler-unbuffered', 'latch-handler-foreign-error', 'latch-rt-signal', 'latch-nested-lines', 'latch-refused-named', 'latch-depth-foreign-raise', 'latch-emt-member', 'latch-depth-paths', 'latch-installed-all', 'latch-set-measured']
DEAD_TEETH = ['latch-handler-dead-stdout']
GUARD_TEETH = ['oracle-missing-case']
LATCH_WRITE = ' ' * 12 + "os.write(1, ('controls signal ' + name + '\\n').encode())\n"
LATCH_PRINT = ' ' * 12 + "print('controls signal ' + signal.Signals(signum).name, flush=True)\n"
LATCH_GUARDED = ' ' * 8 + 'try:\n' + LATCH_WRITE + ' ' * 8 + 'except OSError:\n' + ' ' * 12 + 'pass\n'
LATCH_EXCEPT = ' ' * 8 + 'except OSError:\n' + ' ' * 12 + 'pass\n'
LATCH_NAME = ' ' * 4 + "name = signal.Signals(signum).name if signum in signal.Signals._value2member_map_ else 'SIG' + str(signum)\n"
LATCH_DEPTH_GUARD = "        if LATCH569['depth'] == 1 and not LATCH569['on']:\n"
SCANNER_SEEN = "            seen.append({'pos': len(text[:pos].encode('utf-16-le')) // 2, 'mode': 'regex' if value else 'code'})\n"
MISSING_GUARD = "            if not (case / 'kit.js').exists():\n                missing.append(name)\n"
FIX6_CONTROLS['latch-print-mutant'] = (RUNNER, LATCH_WRITE, LATCH_PRINT, OLD_LATCH_TEETH + ['latch-nested-lines'], 'latch-handler-unbuffered', "error=RuntimeError('reentrant')")
FIX6_CONTROLS['oracle-both-empty-mutant'] = ([FIX6_CONTROLS['oracle-empty-tokens-mutant'][:3], (ORACLE, SCANNER_SEEN, '')], None, None, ORACLE_TEETH, 'oracle-current-green', ('red=0 outcomes=2/2', 'oracle vacuous: kit-canon scanner=0 kit=0'))
FIX6_CONTROLS['oracle-missing-guard-mutant'] = (ORACLE, MISSING_GUARD, '', GUARD_TEETH, 'oracle-missing-case', 'oracle RC=0')
FIX6_CONTROLS['latch-no-oserror-guard'] = (RUNNER, LATCH_GUARDED, LATCH_WRITE[4:], OLD_LATCH_TEETH + DEAD_TEETH, 'latch-handler-dead-stdout', "error=BrokenPipeError(32, 'Broken pipe')")
FIX6_CONTROLS['latch-broad-except'] = (RUNNER, LATCH_EXCEPT, LATCH_EXCEPT.replace('OSError', 'Exception'), FIX6D_LATCH_TEETH + DEAD_TEETH, 'latch-handler-foreign-error', 'error=None')
FIX6_CONTROLS['latch-two-signals'] = (RUNNER, '    for sig in latch_signals569():\n', '    for sig in (signal.SIGTERM, signal.SIGHUP):\n', list(CLEANUP_TEETH), 'cleanup-int-inside', "residue=['check-env']")
FIX6_CONTROLS['latch-enum-name'] = (RUNNER, LATCH_NAME, ' ' * 4 + 'name = signal.Signals(signum).name\n', ['latch-rt-signal'], 'latch-rt-signal', 'error=ValueError')
FIX6_CONTROLS['latch-no-depth'] = (RUNNER, LATCH_DEPTH_GUARD, "        if not LATCH569['on']:\n", ['latch-nested-lines'], 'latch-nested-lines', "fd1=b'controls signal SIGHUP\\n'")
ROW_OK = "        ok = seen == kit['decisions'] and item['name'] == kit['name']\n"
ROW_EMPTY_MUTANT = "        if item['name'] == 'regex-hole/kit':\n            seen = []\n            kit = {'name': kit['name'], 'decisions': []}\n" + ROW_OK
FIX6_CONTROLS['oracle-row-empty-mutant'] = (ORACLE, ROW_OK, ROW_EMPTY_MUTANT, ORACLE_TEETH, 'oracle-current-green', ('red=0', 'oracle vacuous: regex-hole/kit scanner=0 kit=0'))
FIX6_CONTROLS['oracle-stale-expect'] = (ORACLE, 'EXPECT_EMPTY = {\n', "EXPECT_EMPTY = {\n    'regex-hole/kit': 'mutation probe',\n", ORACLE_TEETH, 'oracle-current-green', 'oracle stale expect-empty: regex-hole/kit')
LATCH_REFUSED_PRINT = "            print('latch ' + str(int(sig)) + ' refused: ' + str(error))\n"
FIX6_CONTROLS['latch-refused-silent'] = (RUNNER, LATCH_REFUSED_PRINT, '', ['latch-refused-named'], 'latch-refused-named', 'lines=[]')
FIX6_CONTROLS['latch-refused-no-continue'] = (RUNNER, LATCH_REFUSED_PRINT + '            continue\n', LATCH_REFUSED_PRINT, ['latch-refused-named'], 'latch-refused-named', "blocked=['BLOCKED controls: [Errno 22] Invalid argument']")
LATCH_DEPTH_BEFORE = (
    "    LATCH569['depth'] += 1\n"
    "    LATCH569['caught'].append(signum)\n"
    '    # CONSTRAINT: fd 1 directly, not sys.stdout: the handler may run inside a write of the main thread, and the buffered writer refuses re-entry; a dead fd 1 loses the line, never the cleanup.\n'
    '    try:\n'
    "        os.write(1, ('controls signal ' + name + '\\n').encode())\n"
    '    except OSError:\n'
    '        pass\n'
    "    if LATCH569['depth'] == 1 and not LATCH569['on']:\n"
    "        LATCH569['depth'] -= 1\n"
    '        # CONSTRAINT: SystemExit проходит через finally и не поглощается проверкой бинаря; вложенная доставка (depth > 1) возвращается без исключения, чтобы запись внешнего сигнала дошла.\n'
    "        raise SystemExit(128 + LATCH569['caught'][0])\n"
    "    LATCH569['depth'] -= 1\n"
)
LATCH_DEPTH_AFTER = (
    "    LATCH569['depth'] += 1\n"
    '    try:\n'
    "        LATCH569['caught'].append(signum)\n"
    '        # CONSTRAINT: fd 1 directly, not sys.stdout: the handler may run inside a write of the main thread, and the buffered writer refuses re-entry; a dead fd 1 loses the line, never the cleanup.\n'
    '        try:\n'
    "            os.write(1, ('controls signal ' + name + '\\n').encode())\n"
    '        except OSError:\n'
    '            pass\n'
    "        if LATCH569['depth'] == 1 and not LATCH569['on']:\n"
    '            # CONSTRAINT: SystemExit проходит через finally и не поглощается проверкой бинаря; вложенная доставка (depth > 1) возвращается без исключения, чтобы запись внешнего сигнала дошла.\n'
    "            raise SystemExit(128 + LATCH569['caught'][0])\n"
    '    finally:\n'
    "        LATCH569['depth'] -= 1\n"
)
FIX6_CONTROLS['latch-depth-no-finally'] = (RUNNER, LATCH_DEPTH_AFTER, LATCH_DEPTH_BEFORE, ['latch-depth-foreign-raise'], 'latch-depth-foreign-raise', 'depth_after=1')
FIX6_CONTROLS['latch-no-emt'] = (RUNNER, ', ' + repr('SIGEMT') + ')', ')', ['latch-emt-member'], 'latch-emt-member', 'member=False')
FIX6_CONTROLS['latch-depth-exit-double'] = (RUNNER, LATCH_DEPTH_GUARD, LATCH_DEPTH_GUARD + "            LATCH569['depth'] -= 1\n", ['latch-depth-paths'], 'latch-depth-paths', 'depths=[0, 0, 0, -1, -1,')
FIX6_CONTROLS['latch-depth-oserror-double'] = (RUNNER, LATCH_EXCEPT, ' ' * 8 + 'except OSError:\n' + ' ' * 12 + "LATCH569['depth'] -= 1\n" + ' ' * 12 + 'pass\n', ['latch-depth-paths'], 'latch-depth-paths', 'depths=[0, -1,')
FIX6_CONTROLS['latch-depth-finally-conditional'] = (RUNNER, "    finally:\n        LATCH569['depth'] -= 1\n", "    finally:\n        if LATCH569['on'] or LATCH569['depth'] > 1:\n            LATCH569['depth'] -= 1\n", ['latch-depth-paths'], 'latch-depth-paths', 'depths=[0, 0, 0, 1,')
FIX6_CONTROLS['latch-install-skip-last'] = (RUNNER, '            signal.signal(sig, stop569)\n', '            if sig != latch_signals569()[-1]:\n                signal.signal(sig, stop569)\n', ['latch-installed-all'], 'latch-installed-all', 'missing_count=1')
FIX6_CONTROLS['latch-depth-nested-on-skip'] = (RUNNER, "    finally:\n        LATCH569['depth'] -= 1\n", "    finally:\n        LATCH569['depth'] -= 0 if LATCH569['depth'] > 1 and LATCH569['on'] else 1\n", ['latch-depth-paths'], 'latch-depth-paths', 'depths=[0, 0, 0, 0, 0, 0, 2,')
FIX6_CONTROLS['latch-depth-increment-capped'] = (RUNNER, "    LATCH569['depth'] += 1\n", "    LATCH569['depth'] = min(LATCH569['depth'] + 1, 2)\n", ['latch-depth-paths'], 'latch-depth-paths', 'depths=[0, 0, 0, 0, 0, 0, 0, -1,')
# CONSTRAINT: иглы набора собираются конкатенацией repr: побайтовое имя SIGEMT с запятой и скобкой в этом файле столкнуло бы счётчик мутации latch-no-emt (правило count==1).
LATCH_SET_NAMES = '    for name in (' + ''.join(repr(name) + ', ' for name in ('SIGPOLL', 'SIGIO', 'SIGPWR', 'SIGSTKFLT')) + repr('SIGEMT') + '):\n'
FIX6_CONTROLS['latch-set-drop-pwr'] = (RUNNER, LATCH_SET_NAMES, '    for name in (' + ''.join(repr(name) + ', ' for name in ('SIGPOLL', 'SIGIO', 'SIGSTKFLT')) + repr('SIGEMT') + '):\n', ['latch-set-measured'], 'latch-set-measured', "absent=['SIGPWR']")
LATCH_SET_NUMBERS = '    numbers = [signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGTERM, signal.SIGALRM, signal.SIGUSR1, signal.SIGUSR2, signal.SIGXCPU, signal.SIGXFSZ, signal.SIGVTALRM, signal.SIGPROF]\n'
FIX6_CONTROLS['latch-set-add-winch'] = (RUNNER, LATCH_SET_NUMBERS, LATCH_SET_NUMBERS.replace('[', '[signal.SIGWINCH, ', 1), ['latch-set-measured'], 'latch-set-measured', "extra=['SIGWINCH']")
LATCH_WRITE_NESTED_OFF = ' ' * 12 + "if LATCH569['depth'] == 1 or not LATCH569['on']:\n" + ' ' * 16 + "os.write(1, ('controls signal ' + name + '\\n').encode())\n"
FIX6_CONTROLS['latch-nested-write-on'] = (RUNNER, LATCH_GUARDED, ' ' * 8 + 'try:\n' + LATCH_WRITE_NESTED_OFF + LATCH_EXCEPT, ['latch-depth-paths'], 'latch-depth-paths', "written7=['controls signal SIGTERM']")
LATCH_REFUSE_TOLERANT = '        except (OSError, ValueError, RuntimeError) as error:\n'
FIX6_CONTROLS['latch-refuse-narrow-runner'] = (RUNNER, LATCH_REFUSE_TOLERANT, LATCH_REFUSE_TOLERANT.replace(', RuntimeError', ''), ['latch-installed-all'], 'latch-installed-all', 'run3 rc=1')
FAKE_REFUSE_TOLERANT = 'LATCH_FAKE_REFUSED = (OSError, ValueError, RuntimeError)\n'
FIX6_CONTROLS['latch-refuse-narrow-fake'] = (RUNNER, FAKE_REFUSE_TOLERANT, FAKE_REFUSE_TOLERANT.replace(', RuntimeError', ''), ['latch-installed-all'], 'latch-installed-all', 'missing_count=1 refused=[]')
KIT_SCOPES = {'oracle-current'} | (set(ORACLE_TEETH) - {'oracle-kit-missing'}) | set(GUARD_TEETH) | {name for name, spec in FIX6_CONTROLS.items() if spec[3] is ORACLE_TEETH or spec[3] is GUARD_TEETH}
LATCH_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
class Reentrant:
    def write(self, *args):
        raise RuntimeError('reentrant')
    def flush(self):
        raise RuntimeError('reentrant')
runner.LATCH569['on'] = True
read, write = os.pipe()
saved = os.dup(1)
real = sys.stdout
real.flush()
os.dup2(write, 1)
os.close(write)
sys.stdout = Reentrant()
try:
    runner.stop569(signal.SIGTERM, None)
    error = None
except BaseException as exc:
    error = exc
finally:
    sys.stdout = real
    os.dup2(saved, 1)
    os.close(saved)
data = os.read(read, 4096)
caught = [int(sig) for sig in runner.LATCH569['caught']]
print('error=' + repr(error) + ' fd1=' + repr(data) + ' caught=' + repr(caught))
sys.exit(0 if error is None and data == b'controls signal SIGTERM\\n' and caught == [int(signal.SIGTERM)] else 1)
'''
DEAD_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
real_write = os.write
attempts, raised = [], []
def spy(fd, data):
    attempts.append((fd, data))
    try:
        return real_write(fd, data)
    except OSError as exc:
        raised.append(type(exc).__name__)
        raise
runner.LATCH569['on'] = True
read, write = os.pipe()
os.close(read)
saved = os.dup(1)
sys.stdout.flush()
os.dup2(write, 1)
os.close(write)
os.write = spy
try:
    runner.stop569(signal.SIGTERM, None)
    error = None
except BaseException as exc:
    error = exc
finally:
    os.write = real_write
    os.dup2(saved, 1)
    os.close(saved)
caught = [int(sig) for sig in runner.LATCH569['caught']]
print('error=' + repr(error) + ' caught=' + repr(caught) + ' attempts=' + repr(attempts) + ' raised=' + repr(raised))
sys.exit(0 if error is None and caught == [int(signal.SIGTERM)] and attempts == [(1, b'controls signal SIGTERM\\n')] and raised == ['BrokenPipeError'] else 1)
'''
FOREIGN_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
real_write = os.write
def hostile(fd, data):
    raise TypeError('foreign fd 1')
runner.LATCH569['on'] = True
os.write = hostile
try:
    runner.stop569(signal.SIGTERM, None)
    error = None
except BaseException as exc:
    error = exc
finally:
    os.write = real_write
caught = [int(sig) for sig in runner.LATCH569['caught']]
print('error=' + repr(error) + ' caught=' + repr(caught))
sys.exit(0 if type(error) is TypeError and caught == [int(signal.SIGTERM)] else 1)
'''
RT_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
rtmin = getattr(signal, 'SIGRTMIN', None)
if rtmin is None:
    print('latch-rt-signal refused: platform without SIGRTMIN')
    sys.exit(2)
runner.LATCH569['on'] = True
read, write = os.pipe()
saved = os.dup(1)
sys.stdout.flush()
os.dup2(write, 1)
os.close(write)
try:
    runner.stop569(rtmin + 1, None)
    error = None
except BaseException as exc:
    error = exc
finally:
    os.dup2(saved, 1)
    os.close(saved)
data = os.read(read, 4096)
caught = [int(sig) for sig in runner.LATCH569['caught']]
want = ('controls signal SIG' + str(rtmin + 1) + '\\n').encode()
print('error=' + repr(error) + ' fd1=' + repr(data) + ' caught=' + repr(caught))
sys.exit(0 if error is None and data == want and caught == [rtmin + 1] else 1)
'''
NESTED_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
real_write = os.write
outer = b'controls signal SIGTERM'
def spy(fd, data):
    if data == outer + b'\\n':
        runner.stop569(signal.SIGHUP, None)
    return real_write(fd, data)
runner.LATCH569['on'] = False
read, write = os.pipe()
saved = os.dup(1)
sys.stdout.flush()
os.dup2(write, 1)
os.close(write)
os.write = spy
exits = []
try:
    runner.stop569(signal.SIGTERM, None)
except SystemExit as exc:
    exits.append(exc.code)
finally:
    os.write = real_write
    os.dup2(saved, 1)
    os.close(saved)
data = os.read(read, 4096)
caught = [int(sig) for sig in runner.LATCH569['caught']]
print('error=' + repr(exits) + ' fd1=' + repr(data) + ' caught=' + repr(caught))
sys.exit(0 if exits == [128 + int(signal.SIGTERM)] and caught == [int(signal.SIGTERM), int(signal.SIGHUP)] and sorted(data.split(b'\\n')[:-1]) == sorted([outer, b'controls signal SIGHUP']) else 1)
'''
REFUSED_PROBE = '''import importlib.util
import os
import signal
import subprocess
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner_path, root_path, binary_path, binary_sha = sys.argv[1:5]
real_signal = signal.signal
usr2 = int(signal.SIGUSR2)
calls = []
def fake(sig, handler):
    if sig == usr2:
        calls.append((sig, handler))
        raise OSError(22, 'Invalid argument')
    return real_signal(sig, handler)
subjects = runner.latch_signals569()
before = {sig: signal.getsignal(sig) for sig in subjects}
read, write = os.pipe()
saved = os.dup(1)
sys.stdout.flush()
sys.stdout.reconfigure(line_buffering=True)
os.dup2(write, 1)
os.close(write)
signal.signal = fake
try:
    sys.argv = [runner_path, '--scope', 'binary-check', '--root', root_path, '--binary', binary_path, '--binary-sha256', binary_sha]
    rc = runner.entry569()
except SystemExit as exc:
    rc = exc.code
finally:
    signal.signal = real_signal
    os.dup2(saved, 1)
    os.close(saved)
data = os.read(read, 4096)
base = subprocess.run([sys.executable, runner_path, '--scope', 'binary-check', '--root', root_path + '-base', '--binary', binary_path, '--binary-sha256', binary_sha], stdout=subprocess.DEVNULL)
after = {sig: signal.getsignal(sig) for sig in subjects}
lines = [line for line in data.decode('utf-8', 'replace').splitlines() if line.startswith('latch ')]
blocked = [line for line in data.decode('utf-8', 'replace').splitlines() if line.startswith('BLOCKED controls: ')]
want = 'latch ' + str(usr2) + ' refused: [Errno 22] Invalid argument'
reached = b'fixture-loader-285: explicit binary accepted without test launch' in data
restored = all(after[sig] == before[sig] for sig in subjects)
print('rc=' + repr(rc) + ' base_rc=' + repr(base.returncode) + ' usr2_calls=' + repr(calls) + ' lines=' + repr(lines) + ' reached=' + repr(reached) + ' restored=' + repr(restored) + ' blocked=' + repr(blocked))
sys.exit(0 if lines == [want] and rc == base.returncode and reached and restored and calls == [(usr2, runner.stop569)] and blocked == [] else 1)
'''
DEPTH_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.LATCH569.update(on=True, caught=[], depth=0)
real_write = runner.os.write
def foreign(fd, data):
    raise TypeError('foreign')
runner.os.write = foreign
try:
    try:
        runner.stop569(signal.SIGTERM, None)
    except TypeError:
        pass
    else:
        raise AssertionError('expected TypeError')
    depth_after = runner.LATCH569['depth']
finally:
    runner.os.write = real_write
runner.LATCH569.update(on=False, caught=[], depth=0)
second = None
try:
    runner.stop569(signal.SIGHUP, None)
except SystemExit as exc:
    second = exc.code
print('depth_after=' + str(depth_after) + ' second=' + repr(second))
sys.exit(0 if depth_after == 0 and second == 129 else 1)
'''
EMT_PROBE = '''import importlib.util
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
emt = getattr(signal, 'SIGEMT', None)
planted = emt is None
if planted:
    signal.SIGEMT = 0
    emt = 0
try:
    member = emt in runner.latch_signals569()
finally:
    if planted:
        del signal.SIGEMT
print('emt=' + str(emt) + ' planted=' + repr(planted) + ' member=' + repr(member))
sys.exit(0 if member is True else 1)
'''
SET_PROBE = '''import ctypes
import importlib.util
import os
import resource
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
subjects = set(runner.latch_signals569())
EXCLUDED_NAMES = ('SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGSEGV', 'SIGSYS', 'SIGTRAP', 'SIGPIPE')
excluded = {int(getattr(signal, name)) for name in EXCLUDED_NAMES if hasattr(signal, name)}
def name569(n):
    return signal.Signals(n).name if n in signal.Signals._value2member_map_ else 'SIG' + str(n)
def names569(numbers):
    return '[' + ','.join(repr(name569(n)) for n in sorted(numbers)) + ']'
terminating, ignored, stopped, uncatchable = set(), set(), set(), set()
for n in range(1, signal.NSIG):
    pid = os.fork()
    if pid == 0:
        try:
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            if sys.platform == 'linux':
                if ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0) != 0:
                    os._exit(4)
            signal.signal(n, signal.SIG_DFL)
            signal.pthread_sigmask(signal.SIG_UNBLOCK, [n])
            os.kill(os.getpid(), n)
        except (OSError, ValueError):
            os._exit(3)
        except BaseException:
            os._exit(4)
        os._exit(0)
    _, status = os.waitpid(pid, os.WUNTRACED)
    if os.WIFSTOPPED(status):
        stopped.add(n)
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    elif os.WIFSIGNALED(status):
        if os.WTERMSIG(status) != n:
            print('latch-set-measured refused: n=' + str(n) + ' status=' + str(status))
            sys.exit(2)
        terminating.add(n)
    elif os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0:
        ignored.add(n)
    elif os.WIFEXITED(status) and os.WEXITSTATUS(status) == 3:
        uncatchable.add(n)
    else:
        print('latch-set-measured refused: n=' + str(n) + ' status=' + str(status))
        sys.exit(2)
measured = terminating - excluded
absent = measured - subjects
extra = subjects - measured
phantom = excluded - set(terminating)
print('measured_count=' + str(len(measured)) + ' subjects_count=' + str(len(subjects)) + ' absent=' + names569(absent) + ' extra=' + names569(extra) + ' phantom=' + names569(phantom) + ' ignored=' + names569(ignored) + ' stopped=' + names569(stopped) + ' uncatchable=' + names569(uncatchable))
sys.exit(0 if not absent and not extra and not phantom else 1)
'''
DEPTH_PATHS_PROBE = '''import importlib.util
import os
import signal
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.LATCH569.update(on=True, caught=[], depth=0)
real_write = runner.os.write
depths, exits = [], []
def dead(fd, data):
    raise BrokenPipeError(32, 'Broken pipe')
def foreign(fd, data):
    raise TypeError('foreign')
nested = False
def spy(fd, data):
    global nested
    if not nested:
        nested = True
        runner.stop569(signal.SIGHUP, None)
    return real_write(fd, data)
def step(signum, writer):
    runner.os.write = writer
    outcome = None
    try:
        runner.stop569(signum, None)
    except SystemExit as exc:
        outcome = exc.code
    except TypeError:
        outcome = 'TypeError'
    finally:
        runner.os.write = real_write
    depths.append(runner.LATCH569['depth'])
    exits.append(outcome)
step(signal.SIGTERM, real_write)
step(signal.SIGTERM, dead)
step(signal.SIGTERM, foreign)
runner.LATCH569.update(on=False, caught=[])
step(signal.SIGHUP, real_write)
runner.LATCH569.update(on=False, caught=[])
step(signal.SIGTERM, real_write)
runner.LATCH569.update(on=False, caught=[])
step(signal.SIGTERM, spy)
caught = [int(sig) for sig in runner.LATCH569['caught']]
def chain(signals):
    queue, written = list(signals), []
    def chained(fd, data):
        if queue:
            runner.stop569(queue.pop(0), None)
        written.append(data.decode('utf-8', 'replace').rstrip('\\n'))
        return real_write(fd, data)
    return chained, written
spy7, written7 = chain([signal.SIGHUP])
runner.LATCH569.update(on=True, caught=[])
step(signal.SIGTERM, spy7)
spy8, written8 = chain([signal.SIGHUP, signal.SIGINT])
runner.LATCH569.update(on=False, caught=[])
step(signal.SIGTERM, spy8)
spy9, written9 = chain([signal.SIGHUP, signal.SIGINT])
runner.LATCH569.update(on=True, caught=[])
step(signal.SIGTERM, spy9)
print('depths=' + repr(depths) + ' exits=' + repr(exits) + ' caught=' + repr(caught) + ' written7=' + repr(written7) + ' written8=' + repr(written8) + ' written9=' + repr(written9))
assert caught == [int(signal.SIGTERM), int(signal.SIGHUP)], caught
sys.exit(0 if depths == [0] * 9 and exits == [None, None, 'TypeError', 129, 143, 143, None, 143, None] and written7 == ['controls signal SIGHUP', 'controls signal SIGTERM'] and written8 == ['controls signal SIGINT', 'controls signal SIGHUP', 'controls signal SIGTERM'] and written9 == ['controls signal SIGINT', 'controls signal SIGHUP', 'controls signal SIGTERM'] else 1)
'''
LATCH_FAKE_REFUSED = (OSError, ValueError, RuntimeError)
INSTALLED_PROBE = '''import importlib.util
import os
import signal
import subprocess
import sys
spec = importlib.util.spec_from_file_location('runner569', sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner_path, root_path, binary_path, binary_sha = sys.argv[1:5]
real_signal = signal.signal
tolerated = getattr(runner, 'LATCH_FAKE_REFUSED', (OSError, ValueError, RuntimeError))
SIGPWR = getattr(signal, 'SIGPWR', None)
calls = []
refuse = [None]
def fake(sig, handler):
    if handler is not runner.stop569:
        return real_signal(sig, handler)
    try:
        if SIGPWR is not None and sig == SIGPWR and refuse[0] is not None:
            raise refuse[0]('platform occupied')
        previous = real_signal(sig, handler)
    except tolerated:
        calls.append((sig, 'refused'))
        raise
    calls.append((sig, 'installed'))
    return previous
subjects = runner.latch_signals569()
before = {sig: signal.getsignal(sig) for sig in subjects}
outcomes = []
oks = []
for run in range(4):
    calls = []
    refuse[0] = [None, OSError, ValueError, RuntimeError][run]
    read, write = os.pipe()
    saved = os.dup(1)
    sys.stdout.flush()
    sys.stdout.reconfigure(line_buffering=True)
    os.dup2(write, 1)
    os.close(write)
    signal.signal = fake
    try:
        sys.argv = [runner_path, '--scope', 'binary-check', '--root', root_path + '-' + str(run), '--binary', binary_path, '--binary-sha256', binary_sha]
        rc = runner.entry569()
    except SystemExit as exc:
        rc = exc.code
    finally:
        signal.signal = real_signal
        os.dup2(saved, 1)
        os.close(saved)
    data = os.read(read, 4096)
    base = subprocess.run([sys.executable, runner_path, '--scope', 'binary-check', '--root', root_path + '-base-' + str(run), '--binary', binary_path, '--binary-sha256', binary_sha], stdout=subprocess.DEVNULL)
    after = {sig: signal.getsignal(sig) for sig in subjects}
    seen = [sig for sig, outcome in calls]
    refused = [sig for sig, outcome in calls if outcome == 'refused']
    missing = [s for s in subjects if s not in seen]
    text = data.decode('utf-8', 'replace')
    named = all(('latch ' + str(int(sig)) + ' refused: ') in text for sig in refused)
    restored = all(after[sig] == before[sig] for sig in subjects)
    blocked = [line for line in text.splitlines() if line.startswith('BLOCKED controls: ')]
    ok = seen == subjects and refused == ([SIGPWR] if (SIGPWR is not None and refuse[0] is not None) else []) and (refuse[0] is None or named) and rc == base.returncode and restored and blocked == []
    oks.append(ok)
    outcomes.append('run' + str(run) + ' rc=' + repr(rc) + ' base_rc=' + repr(base.returncode) + ' installed_count=' + str(sum(1 for _, outcome in calls if outcome == 'installed')) + ' subjects_count=' + str(len(subjects)) + ' missing_count=' + str(len(missing)) + ' refused=' + repr([int(sig) for sig in refused]) + ' named=' + repr(named) + ' restored=' + repr(restored) + ' blocked=' + repr(blocked) + ' ok=' + repr(ok))
print(' | '.join(outcomes))
sys.exit(0 if all(oks) else 1)
'''
LATCH_PROBES = {'latch-handler-unbuffered': LATCH_PROBE, 'latch-handler-foreign-error': FOREIGN_PROBE, 'latch-rt-signal': RT_PROBE, 'latch-nested-lines': NESTED_PROBE, 'latch-refused-named': REFUSED_PROBE, 'latch-depth-foreign-raise': DEPTH_PROBE, 'latch-emt-member': EMT_PROBE, 'latch-depth-paths': DEPTH_PATHS_PROBE, 'latch-installed-all': INSTALLED_PROBE, 'latch-set-measured': SET_PROBE}


def environment(root):
    env = os.environ.copy()
    for name, dirname in [('HOME', 'home'), ('CLAUDE_CONFIG_DIR', 'config'), ('TMPDIR', 'tmp')]:
        path = root / dirname
        path.mkdir(parents=True)
        env[name] = str(path)
    env['CLAUDE_CODE_ENABLE_FUNCTION_HOOKS'] = '1'
    return env


def invoke(command, env, log, timeout=90):
    result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
    log.write_text(result.stdout + '\nRC=' + str(result.returncode) + '\n')
    return result.returncode, result.stdout


def killed569(line, out=''):
    names = {re.sub(r'\s+\[[0-9.]+ms\]$', '', part.strip()) for part in re.findall(r'\(fail\) ([^\n]+)', out)}
    print(line + ' extra=' + (','.join(sorted(names)) if names else 'none'))


def contract_tooth(rc, out, message, env, log):
    return invoke([sys.executable, '-c', 'import sys; assert int(sys.argv[1]) == 2 and "НЕ ИЗМЕРЕНО" in sys.argv[2], sys.argv[3]', str(rc), out, message], env, log)


def binary_copy(root):
    return root / ('controls-version-' + str(os.getpid())) / 'binary-2.1.285'


def cleanup569(root):
    # CONSTRAINT: каталог копии и изолированные окружения прогонов не переживают раннер ни на одном исходе набора latch_signals569; SIGKILL/SIGSTOP не перехватываются, синхронные сбои исключены, SIGPIPE вне набора: собственные записи раннера в fd 1 обязаны получать EPIPE исключением (контракт latch-handler-dead-stdout), а не доставкой сигнала; SIGXFSZ при том же стартовом SIG_IGN защёлкивается намеренно; журналы под --root остаются.
    shutil.rmtree(root / ('controls-version-' + str(os.getpid())), ignore_errors=True)
    shutil.rmtree(root / 'check-env', ignore_errors=True)
    for case in root.glob('control-*'):
        shutil.rmtree(case, ignore_errors=True)


def valid_binary(binary, root, want):
    path = Path(binary)
    try:
        if not path.is_absolute() or not stat.S_ISREG(path.lstat().st_mode):
            return False
        copied = binary_copy(root)
        copied.parent.mkdir(parents=True, exist_ok=True)
        env = environment(root / 'check-env')
        with path.open('rb') as source, copied.open('xb') as destination:
            shutil.copyfileobj(source, destination)
        copied.chmod(0o500)
        sha = hashlib.sha256(copied.read_bytes()).hexdigest()
        if sha != want:
            print('binary sha256 mismatch: ' + sha + ' != ' + want)
            return False
        rc, out = invoke([str(copied), '--version'], env, root / 'check-env' / 'version.log')
        print(out.strip(), 'RC=' + str(rc), 'sha256=' + sha, 'copy=' + str(copied))
        if rc != 0 or not out.split() or out.split()[0] != '2.1.285':
            return False
        return True
    except (OSError, subprocess.SubprocessError) as error:
        print('fixture-loader-285: binary check failed: ' + str(error))
        return False


def fixture569(case, program):
    binary = case / 'fixture-binary'
    binary.write_text('#!' + sys.executable + '\n' + program)
    binary.chmod(0o700)
    return binary, hashlib.sha256(binary.read_bytes()).hexdigest()


def entries569(path):
    try:
        return len(os.listdir(path))
    except FileNotFoundError:
        return -1


def cleanup_tooth(name, plug, case, env):
    before, inside = CLEANUP_TEETH[name]
    marker = case / 'version-entered'
    run = case / 'run'
    bulk = run / 'check-env' / 'home' / 'bulk'
    program = 'import os\nfrom pathlib import Path\nimport time\nbulk = Path(os.environ["HOME"]) / "bulk"\nbulk.mkdir()\n'
    program += 'for i in range(' + str(BULK569) + '):\n    (bulk / str(i)).write_bytes(b"")\n'
    program += 'Path(' + repr(str(marker)) + ').write_text("version entered")\n'
    if before:
        program += 'time.sleep(60)\n'
    program += 'print("2.1.285 (FIX6 fixture)")\n'
    binary, sha = fixture569(case, program)
    command = [sys.executable, str(plug / RUNNER), '--scope', 'binary-check', '--root', str(run), '--binary', str(binary), '--binary-sha256', sha]
    sent, witness = [], 'none'
    child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + 60
        while not marker.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        if before and marker.exists() and child.poll() is None:
            child.send_signal(before)
            sent.append(before)
        # CONSTRAINT: the second signal is sent only once the fixture finished writing and cleanup already removed part of check-env.
        while inside and marker.exists() and child.poll() is None and time.monotonic() < deadline:
            left = entries569(bulk)
            if 1000 <= left < BULK569:
                child.send_signal(inside)
                sent.append(inside)
                witness = 'inside cleanup: bulk=' + str(left) + '/' + str(BULK569)
                break
            time.sleep(0.001)
        out, _ = child.communicate(timeout=60)
        rc = child.returncode
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
    wanted = [sig for sig in (before, inside) if sig]
    lines = [line for line in out.splitlines() if line.startswith('controls signal ')]
    residue = sorted(p.name for p in run.glob('*') if p.name.startswith('controls-version-') or p.name == 'check-env')
    ok = sent == wanted and rc == 128 + wanted[0] and lines == ['controls signal ' + signal.Signals(sig).name for sig in wanted] and not residue
    raw = out + '\nrunner RC=' + str(rc) + '\nsent=' + ','.join(signal.Signals(sig).name for sig in sent) + '\nwitness=' + witness + '\nresidue=' + repr(residue) + '\n'
    return ok, raw


def row569(line, name):
    try:
        row = json.loads(line)
    except ValueError:
        return False
    return isinstance(row, dict) and row.get('input') == name and row.get('match') is False


def oracle_tooth(name, plug, case, env, kit):
    binary, sha = fixture569(case, 'print("2.1.285 (FIX6 fixture)")\n')
    command = [sys.executable, str(plug / RUNNER), '--scope', 'oracle-current', '--root', str(case / 'run'), '--binary', str(binary), '--binary-sha256', sha]
    if name != 'oracle-kit-missing':
        subject = Path(kit)
        if name in ('oracle-kit-divergence', 'oracle-canon-outcome'):
            data = subject.read_bytes()
            if name == 'oracle-kit-divergence':
                old, new = (part.encode('utf-8') for part in DIVERGE)
                if data.count(old) != 1:
                    raise ValueError('oracle divergence premise count=' + str(data.count(old)))
                data = data.replace(old, new)
            else:
                rule = json.loads(re.search(r'export const RULE_TEXT\s*=\s*("(?:[^"\\]|\\.)*")', (plug / REGISTER).read_text()).group(1))
                data += ('const REFUSAL_RULE = ' + json.dumps(rule, ensure_ascii=False) + ';\n').encode('utf-8')
            subject = case / 'kit-copy.js'
            subject.write_bytes(data)
        if name == 'oracle-tag-outcome':
            script = plug / PARITY
            script.write_text(replace(script.read_text(), *TAG_SCANNER))
        command += ['--kit', str(subject)]
    rc, out = invoke(command, env, case / 'tooth.log', timeout=600)
    summary = re.search(r'oracle cases=(\d+) sources=(\d+) green=(\d+) red=(\d+)', out)
    decided = bool(summary) and summary.group(2) == summary.group(3) and summary.group(4) == '0'
    if name == 'oracle-kit-missing':
        ok = rc == 2 and '--kit required for oracle-current' in out
    elif name == 'oracle-current-green':
        ok = rc == 0 and decided and 'slash-tag-template outcome ok' in out and 'kit-canon outcome ok' in out
    elif name == 'oracle-kit-divergence':
        ok = rc != 0 and any(row569(line, 'slash-block/kit') for line in out.splitlines())
    else:
        special = 'kit-canon' if name == 'oracle-canon-outcome' else 'slash-tag-template'
        ok = rc != 0 and decided and special + ' outcome mismatch' in out
    return ok, out + '\nrunner RC=' + str(rc) + '\n'


def latch_tooth(plug, case, env, probe, tooth=None):
    command = [sys.executable, '-c', probe, str(plug / RUNNER)]
    if tooth in ('latch-refused-named', 'latch-installed-all'):
        binary, sha = fixture569(case, 'print("2.1.285 (FIX6 fixture)")\n')
        command += [str(case / 'refused-root'), str(binary), sha]
    rc, out = invoke(command, env, case / 'tooth.log')
    if tooth == 'latch-rt-signal' and rc == 2 and 'latch-rt-signal refused:' in out:
        return None, out + '\nprobe RC=' + str(rc) + '\n'
    return rc == 0, out + '\nprobe RC=' + str(rc) + '\n'


def missing_tooth(plug, case, env, kit):
    scripts = plug / 'tests/scripts'
    rc, out = invoke([sys.executable, str(scripts / 'parity-569-fix1.py'), '--scope', 'good,two-literals', '--plugin', str(plug), '--root', str(case / 'inputs'), '--observe'], env, case / 'inputs.log', timeout=600)
    if rc != 0:
        return False, out + '\ninputs RC=' + str(rc) + '\n'
    (case / 'inputs' / 'good' / 'kit.js').unlink()
    rc, out = invoke([sys.executable, str(scripts / 'oracle-569-fix5.py'), '--scope', 'good,two-literals,kit-canon', '--plugin', str(plug), '--kit', kit, '--cases-root', str(case / 'inputs'), '--root', str(case / 'oracle')], env, case / 'oracle.log', timeout=600)
    ok = rc != 0 and 'oracle missing case: good' in out and ' red=0 ' in out
    return ok, out + '\noracle RC=' + str(rc) + '\n'


def fix6_teeth(teeth, plug, case, env, kit):
    failed, raws = [], {}
    for tooth in teeth:
        where = case / ('tooth-' + tooth)
        where.mkdir()
        subject = where / 'plugin'
        shutil.copytree(plug, subject)
        if tooth in CLEANUP_TEETH:
            ok, raw = cleanup_tooth(tooth, subject, where, env)
        elif tooth in LATCH_TEETH or tooth in DEAD_TEETH:
            ok, raw = latch_tooth(subject, where, env, LATCH_PROBES[tooth] if tooth in LATCH_PROBES else DEAD_PROBE, tooth)
        elif tooth in GUARD_TEETH:
            ok, raw = missing_tooth(subject, where, env, kit)
        else:
            ok, raw = oracle_tooth(tooth, subject, where, env, kit)
        raws[tooth] = raw
        print(tooth + ': ' + raw.strip())
        if ok is None:
            print('REFUSED latch-569: ' + tooth, flush=True)
        else:
            print(('PASS ' if ok else 'FAIL ') + ('cleanup-569: ' if tooth in CLEANUP_TEETH else 'latch-569: ' if tooth in LATCH_TEETH or tooth in DEAD_TEETH else 'oracle-gate-569: ') + tooth, flush=True)
            if not ok:
                failed.append(tooth)
    return failed, raws


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--binary-sha256', required=True)
    parser.add_argument('--kit')
    parser.add_argument('--base-register')
    args = parser.parse_args()
    names = args.scope.split(',')
    allowed = set(MUTATIONS) | set(PARITY_CONTROLS) | set(BINARY_FIX5_CONTROLS) | {'binary-symlink-mutant', 'binary-version-mutant', 'binary-relative-mutant', 'binary-copy-mutant', 'binary-sha-mutant', 'binary-cleanup-mutant'} | {'after', 'validate', 'baseline-expanded', 'parity-current', 'parity-good', 'parity-bad', 'parity-absent', 'parity-absence-mutant', 'binary-check', 'binary-alias-mutant'} | set(CLEANUP_TEETH) | set(ORACLE_TEETH) | set(LATCH_TEETH) | set(DEAD_TEETH) | set(GUARD_TEETH) | set(FIX6_CONTROLS) | {'oracle-current'}
    if set(names) - allowed:
        parser.error('unknown scope: ' + ','.join(sorted(set(names) - allowed)))
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* path')
    if 'parity-current' in names and not args.kit:
        parser.error('--kit required for parity-current')
    for name in names:
        if name in KIT_SCOPES and not args.kit:
            parser.error('--kit required for ' + name)
    if 'baseline-expanded' in names and not args.base_register:
        parser.error('--base-register required')
    handlers = {}
    for sig in latch_signals569():
        try:
            previous = signal.getsignal(sig)
            signal.signal(sig, stop569)
        except (OSError, ValueError, RuntimeError) as error:
            # CONSTRAINT: сигнал, занятый площадкой, не валит раннер: отказ именованный, гарда на нём нет.
            print('latch ' + str(int(sig)) + ' refused: ' + str(error))
            continue
        handlers[sig] = previous
    try:
        return run569(args, names, root)
    finally:
        LATCH569['on'] = True
        cleanup569(root)
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        if LATCH569['caught']:
            raise SystemExit(128 + LATCH569['caught'][0])


def latch_signals569():
    # CONSTRAINT: каждый асинхронный перехватываемый сигнал, чьё действие по умолчанию завершает процесс; вне набора: SIGKILL/SIGSTOP не перехватываются; синхронные сбои SIGABRT/SIGBUS/SIGFPE/SIGILL/SIGSEGV/SIGSYS/SIGTRAP исключены — обработчик Python не исполнится до возврата в интерпретатор; SIGPIPE вне набора: собственные записи раннера в fd 1 обязаны получать EPIPE исключением (контракт latch-handler-dead-stdout), а не доставкой сигнала; SIGXFSZ при том же стартовом SIG_IGN защёлкивается намеренно. Тот же перечень исключений держит оракул latch-set-measured.
    numbers = [signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGTERM, signal.SIGALRM, signal.SIGUSR1, signal.SIGUSR2, signal.SIGXCPU, signal.SIGXFSZ, signal.SIGVTALRM, signal.SIGPROF]
    for name in ('SIGPOLL', 'SIGIO', 'SIGPWR', 'SIGSTKFLT', 'SIGEMT'):
        value = getattr(signal, name, None)
        if value is not None:
            numbers.append(value)
    first, last = getattr(signal, 'SIGRTMIN', None), getattr(signal, 'SIGRTMAX', None)
    if first is not None and last is not None:
        numbers.extend(range(first, last + 1))
    # CONSTRAINT: дедуп до возврата: повторная установка дубля (SIGIO == SIGPOLL) затирает handlers[номер] на stop569, и finally восстанавливает stop569 вместо прежнего обработчика.
    return list(dict.fromkeys(numbers))


# CONSTRAINT: сигнал набора latch_signals569 во время уборки не прерывает её; код выхода — первого сигнала.
LATCH569 = {'on': False, 'caught': [], 'depth': 0}


def stop569(signum, frame):
    # CONSTRAINT: имя до try: Signals() для номера вне enum (SIGRTMIN+1..SIGRTMAX-1) бросает ValueError и не должен рвать обработчик.
    name = signal.Signals(signum).name if signum in signal.Signals._value2member_map_ else 'SIG' + str(signum)
    LATCH569['depth'] += 1
    try:
        LATCH569['caught'].append(signum)
        # CONSTRAINT: fd 1 directly, not sys.stdout: the handler may run inside a write of the main thread, and the buffered writer refuses re-entry; a dead fd 1 loses the line, never the cleanup.
        try:
            os.write(1, ('controls signal ' + name + '\n').encode())
        except OSError:
            pass
        if LATCH569['depth'] == 1 and not LATCH569['on']:
            # CONSTRAINT: SystemExit проходит через finally и не поглощается проверкой бинаря; вложенная доставка (depth > 1) возвращается без исключения, чтобы запись внешнего сигнала дошла.
            raise SystemExit(128 + LATCH569['caught'][0])
    finally:
        LATCH569['depth'] -= 1


def run569(args, names, root):
    if not valid_binary(args.binary, root, args.binary_sha256):
        print('fixture-loader-285: explicit binary refused before launch: ' + args.binary)
        return 2
    if names == ['binary-check']:
        print('fixture-loader-285: explicit binary accepted without test launch')
        return 0
    binary = str(binary_copy(root))
    source = Path(__file__).resolve().parents[2]
    logs = root / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    teeth_red = []
    for name in names:
        case = root / ('control-' + name)
        case.mkdir()
        plug = case / 'plugin'
        shutil.copytree(source, plug)
        env = environment(case)
        if name in CLEANUP_TEETH or name in ORACLE_TEETH or name in LATCH_TEETH or name in DEAD_TEETH or name in GUARD_TEETH:
            failed, _ = fix6_teeth([name], plug, case, env, args.kit)
            teeth_red += failed
            continue
        if name in FIX6_CONTROLS:
            file, old, new, teeth, tooth, message = FIX6_CONTROLS[name]
            for file, old, new in (file if isinstance(file, list) else [(file, old, new)]):
                path = plug / file
                text = path.read_text()
                changed = replace(text, old, new)
                if changed == text:
                    raise ValueError('inert FIX6 mutation: ' + name)
                path.write_text(changed)
            failed, raws = fix6_teeth(teeth, plug, case, env, args.kit)
            messages = message if isinstance(message, tuple) else (message,)
            if tooth not in failed or not all(part in raws[tooth] for part in messages):
                raise ValueError('FIX6 mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> ' + tooth + ' -> ' + ' + '.join(messages), ''.join('(fail) ' + t + '\n' for t in failed))
            continue
        if name == 'oracle-current':
            scripts = plug / 'tests/scripts'
            spec = importlib.util.spec_from_file_location('parity569', scripts / 'parity-569-fix1.py')
            parity = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(parity)
            rc, out = invoke([sys.executable, str(scripts / 'parity-569-fix1.py'), '--scope', ','.join(parity.CASES), '--plugin', str(plug), '--root', str(case / 'oracle-inputs'), '--observe'], env, logs / (name + '-inputs.log'), timeout=600)
            print(name + ' inputs: ' + (out.strip().splitlines() or [''])[-1] + ' RC=' + str(rc))
            if rc != 0:
                print(out)
                return rc
            corpus = list(parity.CASES) + ['slash-tag-template', 'kit-canon']
            rc, out = invoke([sys.executable, str(scripts / 'oracle-569-fix5.py'), '--scope', ','.join(corpus), '--plugin', str(plug), '--kit', args.kit, '--cases-root', str(case / 'oracle-inputs'), '--root', str(case / 'oracle')], env, logs / (name + '.log'), timeout=600)
            print(out.strip() + ' RC=' + str(rc))
            if rc != 0:
                return rc
            continue
        if name in BINARY_FIX5_CONTROLS:
            tooth, shape = BINARY_FIX5_CONTROLS[name]
            command = [sys.executable, str(plug / 'tests/scripts/binary-569-fix5.py'), '--scope', tooth, '--plugin', str(plug), '--root', str(case / 'binary-input'), '--mutate', shape]
            rc, out = invoke(command, env, logs / (name + '.log'))
            message = 'binary-fix5-569: ' + tooth
            print(out.strip() + ' RC=' + str(rc))
            if rc != 1 or 'FAIL ' + message not in out:
                raise ValueError('binary FIX5 mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> ' + tooth + ' -> ' + message)
            continue
        if name == 'binary-copy-mutant':
            command = [sys.executable, str(plug / 'tests/scripts/binary-569-fix3.py'), '--scope', 'swap-after-version', '--plugin', str(plug), '--root', str(case / 'binary-input'), '--mutate']
            rc, out = invoke(command, env, logs / (name + '.log'))
            message = 'binary-copy-window-569: replaced original never executes; copy version sha and 0500'
            print(out.strip() + ' RC=' + str(rc))
            if rc != 1 or message not in out:
                raise ValueError('binary-copy mutation did not fail its own tooth')
            killed569('KILLED ' + name + ' -> swap-after-version -> ' + message)
            continue
        if name == 'binary-alias-mutant':
            runner = plug / 'tests/scripts/run-569-controls.py'
            command = [sys.executable, str(runner), '--scope', 'binary-check', '--root', str(case), '--binary', 'claude', '--binary-sha256', '0' * 64]
            code = 'import sys; assert int(sys.argv[1]) == 2 and "explicit binary refused before launch" in sys.argv[2], "fixture-loader-285: PATH alias must be refused before launch"'
            rc, out = invoke(command, env, logs / 'binary-alias-base.log')
            green, raw = invoke([sys.executable, '-c', code, str(rc), out], env, logs / 'binary-alias-base-tooth.log')
            if green != 0:
                raise ValueError('binary-check base tooth failed: ' + raw)
            runner.write_text(replace(runner.read_text(), '\n    if not valid_binary(args.binary, root, args.binary_sha256):\n', '\n    if False:\n'))
            rc, out = invoke(command, env, logs / (name + '.log'))
            red, raw = invoke([sys.executable, '-c', code, str(rc), out], env, logs / 'binary-alias-mutant-tooth.log')
            print(raw.strip() + ' tooth RC=' + str(red))
            if red != 1 or 'fixture-loader-285: PATH alias must be refused before launch' not in raw:
                raise ValueError('binary-check mutant survived')
            killed569('KILLED ' + name + ' -> binary-check -> fixture-loader-285: PATH alias must be refused before launch; base tooth RC=0 mutant tooth RC=1')
            continue
        if name in ('binary-sha-mutant', 'binary-cleanup-mutant'):
            shape = 'drop-sha-pin' if name == 'binary-sha-mutant' else 'drop-cleanup'
            command = [sys.executable, str(plug / 'tests/scripts/binary-569-fix4.py'), '--plugin', str(plug), '--root', str(case / 'binary-input'), '--mutate', shape]
            rc, out = invoke(command, env, logs / (name + '.log'))
            message = 'binary-integrity-569: sha pin and cleanup hold'
            print(out.strip() + ' RC=' + str(rc))
            if rc != 1 or message not in out:
                raise ValueError('binary-integrity mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> binary-integrity-569 -> ' + message)
            continue
        if name in PARITY_CONTROLS:
            tooth, flag, value = PARITY_CONTROLS[name]
            command = [sys.executable, str(plug / 'tests/scripts/parity-569-fix1.py'), '--scope', tooth, '--plugin', str(plug), '--root', str(case / 'parity-input'), flag]
            if value: command.append(value)
            rc, out = invoke(command, env, logs / (name + '.log'))
            message = 'byte-parity-unique-569: ' + tooth
            print(out.strip() + ' RC=' + str(rc))
            if rc != 1 or message not in out:
                raise ValueError('parity mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> ' + tooth + ' -> ' + message)
            continue
        if name in ('binary-symlink-mutant', 'binary-version-mutant', 'binary-relative-mutant'):
            tooth, shape = {'binary-symlink-mutant': ('symlink', 'follow-symlink'), 'binary-version-mutant': ('wrong-version', 'ignore-version'), 'binary-relative-mutant': ('relative', 'accept-relative')}[name]
            command = [sys.executable, str(plug / 'tests/scripts/binary-569-fix2.py'), '--scope', tooth, '--runner', str(plug / 'tests/scripts/run-569-controls.py'), '--binary', binary, '--root', str(case / 'binary-input'), '--mutate', shape]
            rc, out = invoke(command, env, logs / (name + '.log'))
            message = 'binary-contract-569: ' + tooth
            print(out.strip() + ' RC=' + str(rc))
            if rc != 1 or message not in out:
                raise ValueError('binary mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> ' + tooth + ' -> ' + message)
            continue
        if name.startswith('parity-'):
            kit = case / 'tweakcc-patch.js'
            match = re.search(r'export const RULE_TEXT\s*=\s*("(?:[^"\\]|\\.)*")', (plug / REGISTER).read_text())
            rule = json.loads(match.group(1))
            kit.write_text('const REFUSAL_RULE = ' + json.dumps(rule if name != 'parity-bad' else rule[:-1] + '!', ensure_ascii=False) + ';\n')
            env.pop('CATALYST_PATCH_KIT', None)
            if name == 'parity-current':
                env['CATALYST_PATCH_KIT'] = args.kit
            elif name in ('parity-good', 'parity-bad'):
                env['CATALYST_PATCH_KIT'] = str(kit)
            if name == 'parity-absence-mutant':
                script = plug / PARITY
                script.write_text(replace(script.read_text(), "print('[569] splice-parity НЕ ИЗМЕРЕНО: CATALYST_PATCH_KIT is absent or missing')\n    sys.exit(2)", "print('[569] splice-parity PASS: absent kit')\n    sys.exit(0)"))
            rc, out = invoke(['bash', str(plug / PARITY)], env, logs / (name + '.log'))
            expected = {'parity-current': (2, 'НЕ ИЗМЕРЕНО'), 'parity-good': (0, 'PASS'), 'parity-bad': (1, 'FAIL'), 'parity-absent': (2, 'НЕ ИЗМЕРЕНО'), 'parity-absence-mutant': (0, 'PASS')}[name]
            print(name + ': ' + out.strip() + ' RC=' + str(rc))
            if rc != expected[0] or expected[1] not in out:
                raise ValueError('byte-parity control unexpected result: ' + name)
            if name in ('parity-absent', 'parity-absence-mutant'):
                tooth_rc, raw = contract_tooth(rc, out, 'byte-parity: missing kit must be unmeasured', env, logs / (name + '-tooth.log'))
                print(raw.strip() + ' byte-parity tooth RC=' + str(tooth_rc))
                if tooth_rc != (1 if name == 'parity-absence-mutant' else 0):
                    raise ValueError('byte-parity absent-kit tooth unexpected result')
                if name == 'parity-absence-mutant':
                    killed569('KILLED ' + name + ' -> parity-absent -> byte-parity: missing kit must be unmeasured')
            continue
        if name in MUTATIONS:
            file, transform, tooth, message = MUTATIONS[name]
            path = plug / file
            path.write_text(transform(path.read_text()))
        elif name == 'baseline-expanded':
            (plug / REGISTER).write_text(Path(args.base_register).read_text())
        command = 'validate' if name == 'validate' else 'test'
        rc, out = invoke([binary, 'plugin', command, str(plug)], env, logs / (name + '.log'))
        counts = re.search(r'\s\d+ pass\n\s\d+ fail\nRan [^\n]+', out)
        print(name + ': ' + (counts.group(0).strip().replace('\n', '; ') if counts else out.strip()) + ' RC=' + str(rc))
        if name in MUTATIONS:
            if name == 'loader-root-relative':
                killed = rc != 0 and message in out
            else:
                killed = rc != 0 and '(fail) ' + tooth in out and message in out
            if not killed:
                print(out)
                raise ValueError('mutation did not fail its own tooth: ' + name)
            killed569('KILLED ' + name + ' -> ' + tooth + ' -> ' + message, out)
        elif name == 'baseline-expanded':
            if rc == 0:
                raise ValueError('new behavior must be red on base')
        elif rc != 0:
            print(out)
            return rc
    if teeth_red:
        print('fix6 teeth red=' + ','.join(teeth_red))
        return 1
    print('controls scopes=' + str(len(names)) + ' EXIT=0')
    return 0


def entry569():
    try:
        return main()
    except Exception as error:
        print('BLOCKED controls: ' + str(error))
        return 1


if __name__ == '__main__':
    sys.exit(entry569())
