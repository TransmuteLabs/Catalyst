#!/usr/bin/env python3
"""Census guard: every entry point carries the RUNLIMITS-PROLOGUE v1 marker in
its first 40 lines or is named in the allowlist with a reason.

An entry point is a file whose executable code (comments, bare strings and
markdown files do not count) spawns a leaf form (plugin test, claude -p,
node --test, bun test, vitest, jest, pytest, systemd-run) or runs another entry
point (bash X.sh / python3 X.py / node X.mjs ...), closed to a fixed point.

Entry points named in a declared list are judged like found ones; entry
points under an exclusion glob (copies) are counted, not judged.

Exit: 0 clean, 1 violations (one line per file with file:line, stale list
lines), 2 instrument refusal (unreadable root, empty tree list, malformed or
missing list, unreadable file).
Rules: NOTES.md."""
# RUNLIMITS-PROLOGUE v1 profile=unit
import os, sys
_rl_h = os.environ.get("RUNLIMITS_HOME") or None; _rl_s = [_rl_h] if _rl_h else []
_rl_d = None if _rl_h else os.path.dirname(os.path.realpath(__file__))
while _rl_d and not _rl_h:
    _rl_s += [os.path.join(_rl_d, "tools", "run-limits"), os.path.join(_rl_d, "Catalyst", "tools", "run-limits")]
    _rl_h = next((c for c in _rl_s[-2:] if os.path.isfile(os.path.join(c, "runlimits.py"))), None)
    _rl_d = None if os.path.dirname(_rl_d) == _rl_d else os.path.dirname(_rl_d)
if not _rl_h or not os.path.isfile(os.path.join(_rl_h, "runlimits.py")):
    sys.stderr.write("RUNLIMITS: %s refused: library not found (searched: %s)\n" % (sys.argv[0], " ".join(_rl_s))); sys.exit(89)
sys.path.insert(0, _rl_h); import runlimits; runlimits.enter("unit")
import argparse
import glob
import ast
import io
import os
import re
import sys
import tokenize

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ALLOWLIST = "census-allowlist.txt"
DEFAULT_DECLARED = "entrypoints-declared.txt"
DEFAULT_EXCLUDE = "census-exclude.txt"
PROFILE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
MAX_BYTES = 8 << 20
# the marker counts only as a comment line of its own (a string literal is not a prologue)
MARKER_RE = re.compile(r"^\s*(?:#|//)\s*RUNLIMITS-PROLOGUE v1 profile=([A-Za-z0-9_-]+)\s*$")
MARKER_LINES = 40
EXT_KIND = {".sh": "sh", ".bash": "sh", ".zsh": "sh", ".py": "py",
            ".mjs": "js", ".js": "js", ".cjs": "js", ".ts": "js", ".mts": "js", ".cts": "js", ".tsx": "js"}
TOKEN_RE = re.compile(r"[\w./${}@+-]+")
SCRIPT_EXTS = (".sh", ".bash", ".zsh", ".py", ".mjs", ".js", ".cjs", ".ts", ".mts")
# shell command words that run the next operand as a script
SH_INTERP_RE = re.compile(r"^(?:\$\{?\w*(?:PY|PYTHON|NODE|BASH|BUN)\w*\}?|(?:.*/)?(?:ba|z|da)?sh|(?:.*/)?python[0-9.]*"
                          r"|(?:.*/)?node|(?:.*/)?bun|exec|source|\.)$")
# python/js: a spawn API, an interpreter in quotes, or the running interpreter on the same command
SPAWN_RE = re.compile(r"\bsubprocess\.\w+|\bPopen\b|\bos\.(?:system|exec\w*|spawn\w*)\b|\bspawn(?:Sync)?\b"
                      r"|\bexecFile(?:Sync)?\b|\bexecSync\b|\bcheck_call\b|\bcheck_output\b|\brun_one\b"
                      r"|\bsys\.executable\b|\bprocess\.execPath\b|[\"'](?:bash|sh|zsh|python3?|node|bun)[\"']")
JS_IMPORT_RE = re.compile(r"^\s*(?:import\b.*\bfrom\s*|export\b.*\bfrom\s*|.*\bimport\s*\(\s*)[\"'`]([^\"'`]+)[\"'`]")
PY_IMPORT_RE = re.compile(r"^\s*(?:import\s+([\w.]+(?:\s*,\s*[\w.]+)*)|from\s+(\.?[\w.]*)\s+import\s+([\w\s,]+))")
SIBLING = "@sibling:"
CONT_RE = re.compile(r"(?:\\|\(|\[|,)\s*$")
WINDOW = 3


class Refusal(Exception):
    pass


# ------------------------------------------------------------------ comment filters

HEREDOC_OP = re.compile(r"<<(-?)[ \t]*")


def heredoc_at(s):
    """(delimiter, strip_tabs) of a heredoc operator at the start of s, or None.
    The delimiter is any bash word, quote-removed: quoted ('1', "E O F"), bare,
    with digits, partly quoted; `<<-` strips leading tabs (C1, E14, T94)."""
    m = HEREDOC_OP.match(s)
    if not m:
        return None
    word, i, n = [], m.end(), len(s)
    while i < n and s[i] not in " \t;&|<>()":
        c = s[i]
        if c == "'":
            j = s.find("'", i + 1)
            if j < 0:
                return None
            word.append(s[i + 1:j]); i = j + 1
        elif c == '"':
            j = i + 1
            while j < n and s[j] != '"':
                if s[j] == "\\" and j + 1 < n and s[j + 1] in '$`"\\':
                    j += 1
                word.append(s[j]); j += 1
            if j >= n:
                return None
            i = j + 1
        elif c == "\\" and i + 1 < n:
            word.append(s[i + 1]); i += 2
        else:
            word.append(c); i += 1
    if i == m.end():
        return None
    return "".join(word), m.group(1) == "-"


def strip_sh(text):
    out, lines = [], text.split("\n")
    quote = None
    heredoc = None
    for ln in lines:
        if heredoc is not None:
            end = ln.lstrip("\t") if heredoc[1] else ln
            if end == heredoc[0]:
                heredoc = None
                out.append("")
            else:
                out.append("" if ln.lstrip().startswith("#") else ln)
            continue
        buf, i, prev = [], 0, "\n"
        pending_doc = None
        while i < len(ln):
            c = ln[i]
            if quote:
                buf.append(c)
                if c == "\\" and quote == '"' and i + 1 < len(ln):
                    buf.append(ln[i + 1]); i += 2; prev = ""; continue
                if c == quote:
                    quote = None
            elif c in ("'", '"'):
                quote = c; buf.append(c)
            elif c == "\\" and i + 1 < len(ln):
                buf.append(ln[i:i + 2]); i += 2; prev = ""; continue
            elif c == "#" and (prev in " \t\n;&|()" ):
                break
            else:
                if c == "<" and ln.startswith("<<", i) and not ln.startswith("<<<", i):
                    doc = heredoc_at(ln[i:])
                    if doc:
                        pending_doc = doc
                buf.append(c)
            prev = c
            i += 1
        out.append("".join(buf))
        if pending_doc and not quote:
            heredoc = pending_doc
    return out


def strip_py(text):
    lines = text.split("\n")
    keep = [list(l) for l in lines]
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return [re.sub(r"^\s*#.*$", "", l) for l in lines]
    for t in toks:
        if t.type == tokenize.COMMENT:
            (r, c), _ = t.start, t.end
            keep[r - 1] = keep[r - 1][:c]
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        tree = None
    if tree is not None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                for r in range(node.lineno, getattr(node, "end_lineno", node.lineno) + 1):
                    keep[r - 1] = []
    return ["".join(k) for k in keep]


def strip_js(text):
    out, cur = [], []
    i, n = 0, len(text)
    state = "code"
    tmpl_depth = []
    last_sig = ""
    while i < n:
        c = text[i]
        nx = text[i + 1] if i + 1 < n else ""
        if c == "\n":
            out.append("".join(cur)); cur = []
            if state == "line":
                state = "code"
            i += 1
            continue
        # an escaped newline inside a string or a template ends this output line too:
        # source and result lines keep the same indexes (C1, E14, T93)
        if c == "\\" and nx == "\n" and state in ("'", '"', "`"):
            cur.append(c); out.append("".join(cur)); cur = []; i += 2; continue
        if state == "line":
            i += 1; continue
        if state == "block":
            if c == "*" and nx == "/":
                state = "code"; i += 2
            else:
                i += 1
            continue
        if state in ("'", '"'):
            cur.append(c)
            if c == "\\" and nx:
                cur.append(nx); i += 2; continue
            if c == state:
                state = "code"
            i += 1
            continue
        if state == "`":
            cur.append(c)
            if c == "\\" and nx:
                cur.append(nx); i += 2; continue
            if c == "`":
                state = "code"
            elif c == "$" and nx == "{":
                cur.append(nx); tmpl_depth.append(0); state = "code"; i += 2; continue
            i += 1
            continue
        if state == "regex":
            cur.append(c)
            if c == "\\" and nx:
                cur.append(nx); i += 2; continue
            if c == "[":
                state = "regex-class"
            elif c == "/":
                state = "code"
            i += 1
            continue
        if state == "regex-class":
            cur.append(c)
            if c == "\\" and nx:
                cur.append(nx); i += 2; continue
            if c == "]":
                state = "regex"
            i += 1
            continue
        # code
        if c == "/" and nx == "/":
            state = "line"; i += 2; continue
        if c == "/" and nx == "*":
            state = "block"; i += 2; continue
        if c == "/" and (last_sig == "" or last_sig in "(,=:[!&|?{};+-*%<>~^"):
            state = "regex"; cur.append(c); i += 1; continue
        if c in ("'", '"', "`"):
            state = c; cur.append(c); i += 1; continue
        if tmpl_depth:
            if c == "{":
                tmpl_depth[-1] += 1
            elif c == "}":
                if tmpl_depth[-1] == 0:
                    tmpl_depth.pop(); state = "`"; cur.append(c); i += 1; continue
                tmpl_depth[-1] -= 1
        cur.append(c)
        if not c.isspace():
            last_sig = c if not (c.isalnum() or c in "_$") else "a"
        i += 1
    out.append("".join(cur))
    return out


STRIP = {"sh": strip_sh, "py": strip_py, "js": strip_js}


def whole_comment_lines(kind, text):
    """0-based indexes of lines that are nothing but a comment - outside string
    literals, heredocs and template literals: only there a prologue marker
    counts (C1)."""
    lines = text.split("\n")
    out = set()
    if kind == "py":
        try:
            toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
        except (tokenize.TokenError, SyntaxError, IndentationError, ValueError):
            return out
        for t in toks:
            if t.type == tokenize.COMMENT:
                (r, c), _ = t.start, t.end
                if 0 < r <= len(lines) and c == len(lines[r - 1]) - len(lines[r - 1].lstrip()):
                    out.add(r - 1)
        return out
    if kind == "sh":
        quote = None
        heredoc = None
        for i, ln in enumerate(lines):
            if heredoc is not None:
                end = ln.lstrip("\t") if heredoc[1] else ln
                if end == heredoc[0]:
                    heredoc = None
                continue
            if quote is None and ln.lstrip().startswith("#"):
                out.add(i)
                continue
            j = 0
            while j < len(ln):
                ch = ln[j]
                if quote:
                    if ch == "\\" and quote == '"' and j + 1 < len(ln):
                        j += 2
                        continue
                    if ch == quote:
                        quote = None
                elif ch in ("'", '"'):
                    quote = ch
                elif ch == "\\" and j + 1 < len(ln):
                    j += 2
                    continue
                elif ch == "<" and ln.startswith("<<", j) and not ln.startswith("<<<", j):
                    doc = heredoc_at(ln[j:])
                    if doc:
                        heredoc = doc
                        break
                j += 1
        return out
    if kind == "js":
        # a `//` line is a comment iff stripping comments and strings left it empty:
        # inside a template literal the text survives, so it does not count
        stripped = strip_js(text)
        for i, ln in enumerate(lines):
            if ln.lstrip().startswith("//") and i < len(stripped) and stripped[i].strip() == "":
                out.add(i)
        return out
    return out


# ------------------------------------------------------------------ forms

def base(tok):
    return tok.rstrip("/").rsplit("/", 1)[-1]


def claude_head(tok):
    b = base(tok).strip("${}")
    return b.lower() == "claude" or re.fullmatch(r"CLAUDE(?:_(?:BIN|EXE|CMD|CLI|PATH|IMAGE))?", b) is not None


def is_head(tok, name):
    b = base(tok).strip("${}")
    return b == name or b.upper() == name.upper() or b.upper().endswith("_" + name.upper())


def leaf_form(toks, py_import):
    """(form, index of its head token) for the first leaf form in toks, or None."""
    for j, t in enumerate(toks):
        b = base(t)
        nxt = toks[j + 1] if j + 1 < len(toks) else ""
        if b == "plugin" and nxt == "test":
            return "plugin test", j
        if claude_head(t) and "-p" in toks[j + 1:]:
            return "claude -p", j
        if (is_head(t, "node") or t == "process.execPath") \
                and any(x == "--test" or x.startswith("--test=") for x in toks[j + 1:]):
            return "node --test", j
        if is_head(t, "bun") and nxt == "test":
            return "bun test", j
        if b in ("vitest", "jest"):
            return b, j
        if b == "pytest" and not py_import:
            return "pytest", j
        if b == "systemd-run":
            return "systemd-run", j
    return None


def is_script(tok):
    return base(tok).endswith(SCRIPT_EXTS) and not tok.startswith("-")


def sh_calls(toks):
    """Scripts a shell command runs: the command word itself, or the first
    operand after an interpreter word (`-` = script from stdin, not a call)."""
    out = []
    if toks and is_script(toks[0]):
        out.append(toks[0])
    for j, t in enumerate(toks):
        if not SH_INTERP_RE.match(t):
            continue
        k = j + 1
        while k < len(toks) and toks[k].startswith("-") and toks[k] != "-":
            k += 1
        if k < len(toks) and is_script(toks[k]):
            out.append(toks[k])
    return out


def py_sibling_imports(line):
    """Module names a python import line may take from the script's own directory."""
    m = PY_IMPORT_RE.match(line)
    if not m:
        return []
    if m.group(1):
        names = [x.strip().split(".")[0] for x in m.group(1).split(",")]
    elif m.group(2) in ("", "."):
        names = [x.strip() for x in m.group(3).split(",")]
    else:
        names = [m.group(2).lstrip(".").split(".")[0]]
    return [n for n in names if n]


def code_calls(text, toks):
    """python/js: scripts named on a command that spawns; js imports run in-process."""
    m = JS_IMPORT_RE.match(text)
    if m and base(m.group(1)).endswith(SCRIPT_EXTS):
        return [m.group(1)]
    if not SPAWN_RE.search(text):
        return []
    return [t for j, t in enumerate(toks) if is_script(t) and (j == 0 or toks[j - 1] != "-")]


# ------------------------------------------------------------------ scan

def kind_of(path, head):
    ext = os.path.splitext(path)[1]
    if ext in EXT_KIND:
        return EXT_KIND[ext]
    if ext == "" and head.startswith("#!"):
        first = head.split("\n", 1)[0]
        if "python" in first:
            return "py"
        if "node" in first or "bun" in first:
            return "js"
        if re.search(r"\b(ba|z|da)?sh\b", first):
            return "sh"
    return None


class File:
    __slots__ = ("path", "kind", "profile", "leaf", "calls")

    def __init__(self, path, kind, profile, leaf, calls):
        self.path, self.kind, self.profile, self.leaf, self.calls = path, kind, profile, leaf, calls


def scan_file(path, kind, text):
    raw = text.split("\n")
    comments = whole_comment_lines(kind, text)
    profile = None
    for i, ln in enumerate(raw[:MARKER_LINES]):
        if i in comments:
            m = MARKER_RE.match(ln)
            if m:
                profile = m.group(1)
                break
    code = STRIP[kind](text)
    toks = [TOKEN_RE.findall(l) for l in code]
    leaf, calls = None, []
    for i, t in enumerate(toks):
        if not t:
            continue
        py_import = kind == "py" and re.match(r"^\s*(import|from)\s", code[i]) is not None
        if leaf is None:
            # a command may continue on the next lines (`\`, open bracket, trailing comma)
            win, k = list(t), i
            while k < min(len(toks) - 1, i + WINDOW) and CONT_RE.search(code[k]):
                k += 1
                win += toks[k]
            hit = leaf_form(win, py_import)
            if hit and hit[1] < len(t):
                leaf = (i + 1, hit[0])
        # the command this line belongs to: preceding continuation lines + this line
        k = i
        while k > 0 and i - k < WINDOW and CONT_RE.search(code[k - 1]):
            k -= 1
        ctx_toks = [x for r in range(k, i + 1) for x in toks[r]]
        ctx_text = " ".join(code[r] for r in range(k, i + 1))
        found = sh_calls(ctx_toks) if kind == "sh" else code_calls(ctx_text, ctx_toks)
        for x in found:
            if x in t:
                calls.append((i + 1, x))
        if kind == "py":
            for name in py_sibling_imports(code[i]):
                calls.append((i + 1, SIBLING + name + ".py"))
    return File(path, kind, profile, leaf, calls)


def walk_root(root, refusals):
    if not os.path.isdir(root):
        raise Refusal("root not a readable directory: %s" % root)
    try:
        os.listdir(root)
    except OSError as e:
        raise Refusal("root unreadable: %s: %s" % (root, e))

    def onerror(e):
        refusals.append("unreadable dir: %s" % e)

    for dp, dn, fn in os.walk(root, onerror=onerror):
        dn[:] = sorted(d for d in dn if d not in SKIP_DIRS)
        for f in sorted(fn):
            p = os.path.join(dp, f)
            if os.path.islink(p) or f.endswith(".md"):
                continue
            yield p


def resolve(tok, caller, by_base):
    if tok.startswith(SIBLING):
        sib = os.path.join(os.path.dirname(caller), tok[len(SIBLING):])
        return [sib] if sib in by_base.get(os.path.basename(sib), ()) else []
    cands = by_base.get(base(tok))
    if not cands:
        return []
    parts = [x for x in tok.split("/") if x and not x.startswith("$") and x not in (".", "..")]

    def suffix_len(p):
        segs = p.split(os.sep)
        n = 0
        while n < len(parts) and n < len(segs) and segs[-1 - n] == parts[-1 - n]:
            n += 1
        return n

    best = max(suffix_len(c) for c in cands)
    cands = [c for c in cands if suffix_len(c) == best]
    cdir = os.path.dirname(caller)

    def common(p):
        return len(os.path.commonpath([cdir, os.path.dirname(p)]))

    top = max(common(c) for c in cands)
    return [c for c in cands if common(c) == top]


def load_allowlist(path):
    allow = {}
    base_dir = os.path.dirname(os.path.abspath(path))
    try:
        lines = open(path).read().splitlines()
    except OSError as e:
        raise Refusal("allowlist unreadable: %s" % e)
    for n, ln in enumerate(lines, 1):
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        p, _, why = ln.partition("\t")
        if not why.strip():
            raise Refusal("allowlist %s:%d: no reason after a TAB" % (path, n))
        full = p if os.path.isabs(p) else os.path.join(base_dir, p)
        allow[os.path.realpath(full)] = why.strip()
    return allow


def read_list(path, what):
    try:
        lines = open(path).read().splitlines()
    except OSError as e:
        raise Refusal("%s unreadable: %s" % (what, e))
    base_dir = os.path.dirname(os.path.abspath(path))
    for n, ln in enumerate(lines, 1):
        if ln.strip() and not ln.lstrip().startswith("#"):
            yield n, ln, base_dir


def load_declared(path):
    """[(line, realpath, profile)] from `<path>\t<profile>\t<reason>` lines."""
    out = []
    for n, ln, base_dir in read_list(path, "declared list"):
        parts = ln.split("\t")
        if len(parts) < 3 or not parts[2].strip() or not PROFILE_RE.match(parts[1].strip()):
            raise Refusal("declared list %s:%d: want <path> TAB <profile> TAB <reason>" % (path, n))
        full = parts[0] if os.path.isabs(parts[0]) else os.path.join(base_dir, parts[0])
        out.append((n, os.path.realpath(full), parts[1].strip()))
    return out


def load_exclude(path):
    """[(line, glob, set of matched realpaths)] from `<glob>\t<reason>` lines."""
    out = []
    for n, ln, base_dir in read_list(path, "exclusion list"):
        g, _, why = ln.partition("\t")
        if not why.strip():
            raise Refusal("exclusion list %s:%d: no reason after a TAB" % (path, n))
        pat = g if os.path.isabs(g) else os.path.join(base_dir, g)
        hits = {os.path.realpath(m.rstrip("/") or "/") for m in glob.glob(pat, recursive=True)}
        out.append((n, g, hits))
    return out


def excluded_by(path, excl):
    """The glob whose match holds path (the path itself or an ancestor dir), or None."""
    cur = path
    while True:
        for _, g, hits in excl:
            if cur in hits:
                return g
        up = os.path.dirname(cur)
        if up == cur:
            return None
        cur = up


def marker_profile(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(1 << 16).decode("utf-8", "replace")
    except OSError as e:
        raise Refusal("declared file unreadable: %s: %s" % (path, e))
    kind = kind_of(path, head[:256])
    head_comments = whole_comment_lines(kind, head) if kind else set()
    for i, ln in enumerate(head.split("\n")[:MARKER_LINES]):
        if i in head_comments:
            hit = MARKER_RE.match(ln)
            if hit:
                return hit.group(1)
    return None


def default_roots():
    r = os.path.realpath(os.path.join(HERE, "..", ".."))
    parent = os.path.dirname(r)
    return [r, os.path.join(parent, "Catalyst-CC-Patch"), os.path.join(parent, "Catalyst-programs")]


def main(argv):
    ap = argparse.ArgumentParser(description="run-limits census guard")
    ap.add_argument("--root", action="append", help="tree to scan (repeatable); default R, K, G")
    ap.add_argument("--allowlist", help="TAB-separated file: <path>\\t<reason>")
    ap.add_argument("--declared", help="TAB-separated file: <path>\\t<profile>\\t<reason>")
    ap.add_argument("--exclude", help="TAB-separated file: <glob>\\t<reason>")
    ap.add_argument("--list", action="store_true", help="print every entry point with its profile")
    a = ap.parse_args(argv)
    # the lists next to this file belong to the default roots; an explicit --root takes only explicit lists
    defaults = a.root is None
    roots = a.root if a.root is not None else default_roots()
    roots = [r for r in roots if r]
    allow_path = a.allowlist or (os.path.join(HERE, DEFAULT_ALLOWLIST) if defaults else None)
    decl_path = a.declared or (os.path.join(HERE, DEFAULT_DECLARED) if defaults else None)
    excl_path = a.exclude or (os.path.join(HERE, DEFAULT_EXCLUDE) if defaults else None)
    try:
        if not roots:
            raise Refusal("empty tree list")
        allow = load_allowlist(allow_path) if allow_path else {}
        declared = load_declared(decl_path) if decl_path else []
        excl = load_exclude(excl_path) if excl_path else []
        refusals, files, oversize = [], {}, []
        for root in roots:
            for p in walk_root(os.path.realpath(root), refusals):
                try:
                    size = os.path.getsize(p)
                    with open(p, "rb") as fh:
                        head = fh.read(256).decode("utf-8", "replace")
                    kind = kind_of(p, head)
                    if kind is None:
                        continue
                    if size > MAX_BYTES:
                        oversize.append((p, size))
                        continue
                    with open(p, "rb") as fh:
                        text = fh.read().decode("utf-8", "replace")
                except OSError as e:
                    refusals.append("unreadable file: %s: %s" % (p, e))
                    continue
                files[p] = scan_file(p, kind, text)
        if refusals:
            raise Refusal("; ".join(refusals[:20]) + (" (+%d more)" % (len(refusals) - 20) if len(refusals) > 20 else ""))
        decl_ok, stale = {}, []
        real_roots = [os.path.realpath(r) for r in roots]
        for n, full, prof in declared:
            if not os.path.isfile(full):
                stale.append("VIOLATION %s:%d: stale declaration %s (no such file)" % (decl_path, n, full))
            elif not any(full.startswith(r.rstrip(os.sep) + os.sep) for r in real_roots):
                continue  # judged only in the run of the tree that holds it (E15, T95)
            elif full not in decl_ok:
                decl_ok[full] = (n, prof, files[full].profile if full in files else marker_profile(full))
    except Refusal as e:
        sys.stderr.write("census-guard: refused: %s\n" % e)
        return 2

    by_base = {}
    for p in files:
        by_base.setdefault(os.path.basename(p), []).append(p)
    edges = {}
    for p, f in files.items():
        for line, tok in f.calls:
            for t in resolve(tok, p, by_base):
                if t != p:
                    edges.setdefault(p, []).append((line, t))

    entry = {p: f.leaf for p, f in files.items() if f.leaf}
    seeded = set()
    for p in decl_ok:
        if p not in entry:
            entry[p] = (1, "declared %s (%s:%d)" % (decl_ok[p][1], decl_path, decl_ok[p][0]))
            seeded.add(p)
    changed = True
    while changed:
        changed = False
        for p in files:
            if p in entry:
                continue
            for line, tgt in edges.get(p, ()):
                if tgt in entry:
                    entry[p] = (line, "runs entry point %s" % tgt)
                    changed = True
                    break

    by_form, excluded = {}, {}
    for p, hit in entry.items():
        g = excluded_by(p, excl)
        if g is not None and p not in decl_ok:
            excluded[p] = (hit, g)
        elif p not in seeded:
            by_form[p] = hit
    judged = dict(by_form)
    for p, (n, prof, _) in decl_ok.items():
        if p not in judged:
            judged[p] = (1, "declared %s (%s:%d)" % (prof, decl_path, n))
    list_viol = list(stale)
    for p, size in sorted(oversize):
        if excluded_by(p, excl) is None:
            list_viol.append("VIOLATION %s: %d B > %d B, not scanned (exclude it with a reason or split it)" % (p, size, MAX_BYTES))
    for p, (n, prof, _) in sorted(decl_ok.items()):
        g = excluded_by(p, excl)
        if g is not None:
            list_viol.append("VIOLATION %s:%d: exclusion hides declared entry %s (%s)" % (decl_path, n, p, g))
    for n, g, hits in excl:
        if not hits:
            list_viol.append("VIOLATION %s:%d: stale exclusion %s (matches nothing)" % (excl_path, n, g))
    n_pro = n_allow = n_viol = 0
    for p in sorted(judged):
        line, form = judged[p]
        profile = files[p].profile if p in files else decl_ok[p][2]
        if p in decl_ok and not form.startswith("declared "):
            form = "%s; declared %s" % (form, decl_ok[p][1])
        allowed = os.path.realpath(p) in allow
        if profile:
            n_pro += 1
            state = "profile=%s" % profile
        elif allowed:
            n_allow += 1
            state = "profile=NONE allowlisted: %s" % allow[os.path.realpath(p)]
        else:
            n_viol += 1
            state = "profile=NONE"
            if not a.list:
                print("VIOLATION %s:%d: %s (no RUNLIMITS-PROLOGUE v1 in the first %d lines)" % (p, line, form, MARKER_LINES))
        if a.list:
            print("ENTRY %s:%d %s form=%s" % (p, line, state, form))
    if a.list:
        for p in sorted(excluded):
            (line, form), g = excluded[p]
            print("EXCLUDED %s:%d form=%s glob=%s" % (p, line, form, g))
    for v in list_viol:
        print(v)
    n_viol += len(list_viol)
    print("census-guard: %d entry points (%d by form, %d declared), %d with prologue, %d allowlisted, "
          "%d excluded, %d violations"
          % (len(judged), len(by_form), len(decl_ok), n_pro, n_allow, len(excluded), n_viol))
    return 1 if n_viol else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
