# Rules for agents

The canonical rule compendium for every library of the family lives at the
Nexus folder root, `AGENTS.md`. The pointer chain starts one level up from
this repository (`../AGENTS.md`) and resolves to that canon. Read the canon,
not this file: this is only a pointer, because vendor CLIs do not climb above
their own git root.

If the canon is unreachable (an isolated checkout), the minimum that always
applies:

- **Code comments — only constraints**: a boundary, an invariant, a
  "why not otherwise", a reference to the canonical home of the rule.
  Narrative (edit history, a retelling of the diff, "how it was and why it
  changed") is not written into code — its place is in the commit message
  and in the `NOTES.md` next to the code.
- **No git commits without an explicit assignment**; write only to the files
  the assignment names.

Architecture and layers are in this repository's `README.md`.
