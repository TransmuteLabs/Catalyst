#!/usr/bin/env bash
# CONSTRAINT: plugin test has no host fs implementation; this stand uses session.start before the API request (ADJUDICATION-510-G17.md).
set -u
if [ "$(uname -s)" != Linux ]; then
  printf 'form-host-parity: НЕ ИЗМЕРЕНО: только linux\n'
  exit 3
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || exit 2
IMAGE="${FORM_HOST_PARITY_IMAGE:-}"
if [ "$#" -eq 2 ] && [ "$1" = --image ]; then IMAGE="$2"
elif [ "$#" -ne 0 ]; then printf 'form-host-parity: отказ прибора: нужен --image <path>\n'; exit 2
fi
if [ -z "$IMAGE" ]; then
  # CONSTRAINT: образ по умолчанию — пристин версии фикстуры; отсутствие пристина — НЕ ИЗМЕРЕНО (rc 3), а не отказ прибора: штатный раннер без образа не краснеет.
  HOST_VERSION="$(python3 - "$ROOT/tests/fixtures/form-host-decode.json" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1]))["hostVersion"])
except Exception as x:
    print("form-host-parity: отказ прибора: фикстура: " + str(x), file=sys.stderr)
    sys.exit(2)
PY
)" || exit 2
  # CONSTRAINT: hostVersion вне формы X.Y.Z — сломанная фикстура: отказ прибора (rc 2), путь пристина из неё не строится.
  if [[ ! "$HOST_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'form-host-parity: отказ прибора: фикстура: hostVersion %s\n' "'$HOST_VERSION'" >&2
    exit 2
  fi
  IMAGE="${XDG_DATA_HOME:-$HOME/.local/share}/catalyst-cc/pristine/${HOST_VERSION}.orig"
  [ -f "$IMAGE" ] || { printf 'form-host-parity: НЕ ИЗМЕРЕНО: образ %s отсутствует\n' "$IMAGE"; exit 3; }
fi
command -v systemd-run >/dev/null || { printf 'form-host-parity: отказ прибора: systemd-run отсутствует\n'; exit 2; }
python3 - "$ROOT" "$IMAGE" <<'PY'
import difflib, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tempfile
root=pathlib.Path(sys.argv[1]); image=pathlib.Path(sys.argv[2]).resolve()
def refuse(reason):
    print('form-host-parity: отказ прибора: '+reason,flush=True);sys.exit(2)
def mismatch(name,expected,actual):
    print('form-host-parity: mismatch '+name,flush=True)
    print(''.join(difflib.unified_diff(json.dumps(expected,indent=2,ensure_ascii=False).splitlines(True),json.dumps(actual,indent=2,ensure_ascii=False).splitlines(True),fromfile='fixture',tofile=name)),flush=True)
try:
    expected=json.loads((root/'tests/fixtures/form-host-decode.json').read_text())
    source=(root/'plugins/catalyst-probes/tests/units.test.ts').read_text()
    blocks=re.findall(r'^// G17-HOST-DECODE-BEGIN\n(.*?)^// G17-HOST-DECODE-END$',source,re.M|re.S)
    if len(blocks)!=1: refuse('литерал U: маркеры не уникальны')
    literal=blocks[0].split('=',1)[1].strip()
    actual_literal=json.loads(literal)
except (OSError,ValueError,IndexError) as x: refuse('фикстура/литерал: '+str(x))
if actual_literal!=expected:
    mismatch('U literal',expected,actual_literal);sys.exit(1)
if not image.is_file(): refuse('образ отсутствует: '+str(image))
work=pathlib.Path(tempfile.mkdtemp(prefix='w510-fix4-host-parity-',dir='/var/tmp'))
try:
    for n in ['home','tmp','config','data','files','plugin/.claude-plugin','plugin/hooks']: (work/n).mkdir(parents=True,exist_ok=True)
    binary=work/'claude';shutil.copyfile(image,binary);binary.chmod(0o755)
    digest=hashlib.sha256(binary.read_bytes()).hexdigest()
    if digest!=expected['imageSha256']:
        mismatch('imageSha256',expected['imageSha256'],digest);sys.exit(1)
    env=dict(os.environ,HOME=str(work/'home'),TMPDIR=str(work/'tmp'),CLAUDE_CONFIG_DIR=str(work/'config'),XDG_DATA_HOME=str(work/'data'),CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',ANTHROPIC_API_KEY='dummy',ANTHROPIC_BASE_URL='http://127.0.0.1:9')
    version=subprocess.run([str(binary),'--version'],env=env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=30)
    if version.returncode!=0: refuse('образ не запустился: '+version.stderr)
    if version.stdout.split()[0]!=expected['hostVersion']:
        mismatch('hostVersion',expected['hostVersion'],version.stdout.strip());sys.exit(1)
    for c in expected['cases']: (work/'files'/c['name']).write_bytes(bytes.fromhex(c['bytesHex']))
    (work/'plugin/.claude-plugin/plugin.json').write_text(json.dumps({'name':'form-host-parity-510','version':'0.0.0'}))
    names=json.dumps([c['name'] for c in expected['cases']]); files=json.dumps(str(work/'files')+'/'); output=json.dumps(str(work/'out.json'))
    stand='export function register(on: any) {\n on("session.start", async ($: any, e: any, next: any) => {\n const out: any = {}\n for (const n of '+names+') {\n try { const t = await $.fs.read('+files+' + n); const b = await $.fs.read('+files+' + n, {as:"bytes"}); out[n] = {cps:Array.from(t as string).map((c:string)=>c.codePointAt(0)),b64:b.base64} } catch(x:any) { out[n]={err:String(x && x.message || x)} }\n }\n await $.fs.write('+output+',JSON.stringify(out))\n return next(e)\n })\n}\n'
    (work/'plugin/hooks/register.ts').write_text(stand)
    (work/'plugin/hooks/hooks.json').write_text(json.dumps({'modules':['./register.ts']}))
    if not (work/'plugin/hooks/hooks.json').is_file(): refuse('hooks.json не записан')
    with (work/'session.log').open('w') as log:
        result=subprocess.run(['systemd-run','--user','--scope','--quiet','-p','MemoryMax=4G','-p','MemorySwapMax=0','timeout','--foreground','--signal=TERM','--kill-after=5s','20s',str(binary),'-p','hi','--plugin-dir',str(work/'plugin')],env=env,cwd=work,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=40)
    raw=(work/'session.log').read_text()
    print('SESSION_EXIT='+str(result.returncode),flush=True)
    if not (work/'out.json').is_file(): refuse('JSON не записан; session log:\n'+raw)
    observed=json.loads((work/'out.json').read_text())
    if any('err' in x for x in observed.values()): refuse('чтение хоста отказало: '+json.dumps(observed))
    import base64
    actual={'hostVersion':expected['hostVersion'],'imageSha256':digest,'cases':[dict(name=c['name'],bytesHex=base64.b64decode(observed[c['name']]['b64']).hex(),codePoints=observed[c['name']]['cps']) for c in expected['cases']]}
    if actual!=expected:
        mismatch('live host',expected,actual);sys.exit(1)
    print('HOST_PARITY=7/7\nU_LITERAL_PARITY=7/7\nFORM_HOST_PARITY_EXIT=0',flush=True)
except (OSError,ValueError,KeyError,subprocess.TimeoutExpired) as x: refuse(str(x))
finally:
    shutil.rmtree(work)
    print('REMOVED='+str(work),flush=True)
PY
