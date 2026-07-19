#!/usr/bin/env python3
"""Catalyst family lint — free, deterministic checks that replace whole
classes of paid review findings. Run from anywhere: paths resolve from the
repo root (this file's grandparent).

Checks:
  1. Frontmatter: every skills/*/SKILL.md and agents/*.md has a name matching
     its directory/filename and a trigger-style description.
  2. Budgets: SKILL.md hot path <= 12KB and no line > 1500 chars (re-bloat
     guard; references are exempt - they are cold-path by design).
  3. Dangling pointers: every `references/<x>.md`, `scripts/<x>`, and
     `catalyst:<name>` mention resolves to a real file/skill/agent.
  4. map.tsv: every scenario row names an existing scenario file and existing
     mapped files; no duplicate keys; keys within the portable grammar.
  5. INDEX.md scenario count matches map.tsv.

Exit 0 = clean (warnings allowed), 1 = errors found.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def frontmatter(text):
    if not text.startswith('---\n'):
        return {}
    end = text.find('\n---', 4)
    if end == -1:
        return {}
    fm = {}
    for line in text[4:end].split('\n'):
        if ':' in line and not line.startswith((' ', '\t')):
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip()
    return fm


# ---- collect the universe ----
skills_dir = os.path.join(ROOT, 'skills')
agents_dir = os.path.join(ROOT, 'agents')
skill_names = sorted(
    d for d in os.listdir(skills_dir)
    if os.path.isfile(os.path.join(skills_dir, d, 'SKILL.md')))
agent_names = sorted(
    f[:-3] for f in os.listdir(agents_dir) if f.endswith('.md'))

# ---- 1 + 2: frontmatter and budgets ----
for name in skill_names:
    path = os.path.join(skills_dir, name, 'SKILL.md')
    text = open(path).read()
    rel = os.path.relpath(path, ROOT)
    fm = frontmatter(text)
    if fm.get('name') != name:
        err(f"{rel}: frontmatter name '{fm.get('name')}' != directory '{name}'")
    desc = fm.get('description', '')
    if not desc:
        err(f"{rel}: missing description")
    elif not desc.startswith('Use '):
        warn(f"{rel}: description does not start with a trigger ('Use when...')")
    size = len(text.encode())
    if size > 12 * 1024:
        warn(f"{rel}: hot path {size/1024:.1f}KB exceeds the 12KB budget")
    for i, line in enumerate(text.split('\n'), 1):
        if len(line) > 1500:
            warn(f"{rel}:{i}: line of {len(line)} chars (>1500) in the hot path")

for name in agent_names:
    path = os.path.join(agents_dir, name + '.md')
    fm = frontmatter(open(path).read())
    if fm.get('name') != name:
        err(f"agents/{name}.md: frontmatter name '{fm.get('name')}' != filename")
    if not fm.get('description'):
        err(f"agents/{name}.md: missing description")

# ---- 3: dangling pointers ----
md_files = []
for base in (skills_dir, agents_dir):
    for dirpath, _, files in os.walk(base):
        for f in files:
            if f.endswith('.md'):
                md_files.append(os.path.join(dirpath, f))

all_reference_files = set()
for name in skill_names:
    refdir = os.path.join(skills_dir, name, 'references')
    if os.path.isdir(refdir):
        for f in os.listdir(refdir):
            all_reference_files.add(f)

for path in md_files:
    text = open(path).read()
    rel = os.path.relpath(path, ROOT)
    skill_dir = os.path.dirname(path) if os.path.basename(
        path) == 'SKILL.md' else os.path.dirname(os.path.dirname(path))
    # references/<x>.md mentions
    for m in set(re.findall(r'references/([A-Za-z0-9._-]+\.md)', text)):
        local = os.path.join(skill_dir, 'references', m)
        if not os.path.isfile(local) and m not in all_reference_files:
            err(f"{rel}: dangling pointer references/{m}")
    # scripts mentions (family scripts live under skills/*/scripts/)
    for m in set(re.findall(r'(?<![A-Za-z])scripts/([A-Za-z0-9._-]+)', text)):
        candidates = [os.path.join(skills_dir, s, 'scripts', m) for s in skill_names]
        candidates.append(os.path.join(ROOT, 'scripts', m))
        if not any(os.path.isfile(c) for c in candidates):
            err(f"{rel}: dangling pointer scripts/{m}")
    # catalyst:<name> mentions
    for m in set(re.findall(r'catalyst:([a-z][a-z0-9-]*)', text)):
        if m not in skill_names and m not in agent_names and m != 'catalyst':
            err(f"{rel}: unknown catalyst:{m} (not a skill or agent)")

# ---- 4: map.tsv ----
map_path = os.path.join(ROOT, 'tests', 'pressure', 'map.tsv')
rows = []
if os.path.isfile(map_path):
    seen = set()
    for i, line in enumerate(open(map_path).read().splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split('\t')
        if len(parts) < 3:
            err(f"map.tsv:{i}: fewer than 3 fields")
            continue
        key, model, files = parts[0], parts[1], parts[2:]
        rows.append(key)
        if key in seen:
            err(f"map.tsv:{i}: duplicate key '{key}'")
        seen.add(key)
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', key):
            err(f"map.tsv:{i}: key '{key}' outside the portable grammar")
        scen = os.path.join(ROOT, 'tests', 'pressure', 'scenarios', key + '.md')
        if not os.path.isfile(scen):
            err(f"map.tsv:{i}: scenario file missing for '{key}'")
        for f in files:
            if not os.path.isfile(os.path.join(ROOT, f)):
                err(f"map.tsv:{i}: mapped file '{f}' does not exist")

# ---- 5: INDEX.md count ----
index_path = os.path.join(ROOT, 'tests', 'pressure', 'INDEX.md')
if os.path.isfile(index_path) and rows:
    index_keys = re.findall(r'^\| `([a-z0-9-]+)` \|', open(index_path).read(), re.M)
    if sorted(index_keys) != sorted(rows):
        err(f"INDEX.md scenarios ({len(index_keys)}) do not match map.tsv ({len(rows)}) — regenerate the index")

# ---- 6: every reference file declares its read-on triggers ----
for name in skill_names:
    refdir = os.path.join(skills_dir, name, 'references')
    if not os.path.isdir(refdir):
        continue
    for f in sorted(os.listdir(refdir)):
        if not f.endswith('.md'):
            continue
        text = open(os.path.join(refdir, f)).read()
        rel = f'skills/{name}/references/{f}'
        if not text.startswith('---\n'):
            err(f"{rel}: missing frontmatter (read-on/home-of)")
        elif 'read-on:' not in text.split('\n---')[0]:
            err(f"{rel}: frontmatter lacks read-on:")

# ---- 7: norms.yaml — ids unique, every home/mirror path exists ----
norms_path = os.path.join(ROOT, 'norms.yaml')
if os.path.isfile(norms_path):
    ids, cur = set(), None
    for i, line in enumerate(open(norms_path).read().splitlines(), 1):
        m = re.match(r'\s*-\s*id:\s*(\S+)', line)
        if m:
            cur = m.group(1)
            if cur in ids:
                err(f"norms.yaml:{i}: duplicate norm id '{cur}'")
            ids.add(cur)
            continue
        m = re.match(r"\s*(?:home:|-)\s*((?:skills|agents|scripts|tests)/\S+)", line)
        if m:
            p = m.group(1)
            if not os.path.isfile(os.path.join(ROOT, p)):
                err(f"norms.yaml:{i}: path '{p}' does not exist (norm '{cur}')")

# ---- report ----
for w in warnings:
    print(f"WARN  {w}")
for e in errors:
    print(f"ERROR {e}")
print(f"lint: {len(errors)} errors, {len(warnings)} warnings "
      f"({len(skill_names)} skills, {len(agent_names)} agents, {len(rows)} scenarios)")
sys.exit(1 if errors else 0)
