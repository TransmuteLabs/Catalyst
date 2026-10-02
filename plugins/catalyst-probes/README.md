# catalyst-probes

One hooks module provides the consultation engine and deterministic form judge.
Consultants and form rules are configured in `probes.toml`; arming and the
consultant contract are documented in [NOTES.md](NOTES.md).

## Form boundary

судятся перенаправления, tee и перечисленные писатели; записи внутри интерпретаторов — вне суда

The listed writers are `cp`, `mv`, `install`, `dd of=`, in-place `sed` and `perl`,
`truncate`, and forced symbolic `ln`. Targets must be statically determinable.
Dynamic target words and unknown working directories are named warnings.
The command model covers the union of bash and zsh views, including shell
snapshots, static assignments, glob candidates, and pipeline state variants.

Writes are judged after execution, including when execution throws, except that
candidate fan-out under `log_only` skips post-judgment (`form-post-skipped-fanout`).
Refusing classes use compare-and-restore of the original file/link/absent state;
changed or unavailable fingerprints and retargeted parent paths prevent
restoration and produce named warnings. Restoration replaces the path object,
not the contents of a new link's referent. Rollback warnings augment the original
record without replacing its refusal.
Backup eligibility is computed per target: F plus that target's A1–A3/C1.
All applicable classes set to `log_only` means no backup and no restoration for
that target; its bytes do not consume the shared backup budget. Missing parents
are allowed during preparation, but restoration checks the saved ancestor and
new directory chain. Restoration uses platform-specific destination flags and
checks the resulting file fingerprint or link spelling after replacement.
The backup budget is 8 times the 4 MiB judgment threshold per call:
превышение объёма бэкапа отказывает вызов до исполнения.

The module version is 0.1.55. Deliver the module first and its canon second,
in one delivery step. Missing required canon keys give an explicit F rather
than silently disabling form judgment. Validation/tests do not activate the
installed plugin.
