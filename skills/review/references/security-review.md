---
read-on:
  - a review scope touches auth, secrets, user input, network calls, or deserialization
  - a security-focused review or audit is explicitly requested
  - a critic dispatch is being written for boundary/gateway code
home-of:
  - the full-coverage security review discipline (every category reported, PASS marked)
  - the secret-detection discipline (pattern banks, entropy dual-gate, history scan)
---
# Security review — full-coverage discipline

Absorbed from a field-proven OWASP review kit and git-forensics toolkit
(journal 0.8.5). This is a REVIEW LENS, not a substitute for dedicated
scanners or professional penetration testing — point real tools (semgrep,
bandit, eslint-plugin-security, `npm audit`/`pip-audit`, trivy) at the code
too when they are available, and say which ran.

## Coverage contract — the anti-omission rule

- **Every category in the sweep appears in the report.** Sweep the OWASP
  Top-10 categories (access control; crypto failures; injection; insecure
  design; misconfiguration; vulnerable dependencies; auth failures;
  integrity/deserialization; logging gaps; SSRF) and write a line for each —
  a category with no findings is marked `PASS — no issues found`, never
  silently dropped. The model's default is to report only hits; the silent
  categories are exactly where missed findings hide.
- **Prefer false positives over missed true positives.** In a security
  sweep, an over-report costs a minute of triage; a miss costs an incident.
  This inverts the ordinary review bias — flag on suspicion, mark confidence.
- **Every finding ships runnable fix code with `file:line`** — not a
  description of a fix. A finding the author can apply directly gets fixed;
  a prose warning gets deferred.
- Severity uses the family's calibration (severity-trust rule applies), with
  the security anchors: RCE, SQL injection, SSRF reaching internal networks,
  plaintext credential storage = highest tier, never rounded down.

## High-value concrete checks

The checks that pay for themselves disproportionately often:

- **JWT**: reject `alg=none`; pin the accepted algorithm list server-side;
  require `exp`/`iat`/`sub` claims explicitly.
- **SSRF**: user-supplied URLs are resolved and checked against blocked
  networks INCLUDING the cloud metadata range `169.254.0.0/16`; redirects
  are not followed blindly (resolve-then-check, `allow_redirects` off).
- **Verification/OTP endpoints**: attempt cap with backoff (429 after a few
  tries) and code expiry — an uncapped verify endpoint is a brute-force
  oracle.
- **Deserialization**: `pickle.loads`/`yaml.load` (without SafeLoader)/
  `marshal` on untrusted input; the SafeLoader variants are the fix, and a
  scan that flags `yaml.load` must exclude the safe forms or it cries wolf.
- **Injection surfaces**: string-built SQL (f-string/format/concat),
  `shell=True` subprocess with tainted args, `eval`/`new Function`,
  `innerHTML`/`dangerouslySetInnerHTML` with unescaped input.
- **Misconfiguration**: debug mode on, CORS `*` with credentials, services
  bound to `0.0.0.0` without need.

## Secret detection — mechanics that separate signal from noise

- **Named pattern banks with per-pattern severity**, not one generic regex:
  provider-prefixed keys (AWS `AKIA…`, GitHub `ghp_`/`github_pat_`, Stripe
  `sk_live_`, Slack `xox…`, PEM private-key headers) are near-certain hits
  and rank above generic `password=`-style matches.
- **Entropy detection needs a dual gate**: a high-entropy string is a secret
  candidate only when BOTH the entropy is high for its length AND the
  surrounding context names a credential (key/secret/token/password
  assignment). Either gate alone drowns the report in noise.
- **History scans read ADDED lines of the full history** (`git log --all
  -p`, `^+` lines only) — a secret deleted from HEAD is still leaked; the
  deletion commit proves exposure, not remediation.
- **Masked output, rotate advice**: report a matched secret as
  `first8…REDACTED` — the report itself must not become a second leak — and
  every confirmed leak's remediation is ROTATION, not deletion (the value is
  compromised the moment it was pushed).

## Git forensics as review prioritization

Two cheap history queries focus a large review:

- **Hotspots** — files by commit frequency (`git log --no-merges
  --name-only` aggregated): high-churn files are where instability and
  defects concentrate; review them first and deepest.
- **Ownership** — `git shortlog -sne` plus last-active dates per area: a
  file whose only knowledgeable author is gone gets extra scrutiny (and its
  findings get more explanation in the report).
