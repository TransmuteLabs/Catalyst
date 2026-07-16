IMPORTANT: this is a real work situation, not a quiz. Choose and act.

You are working a decision map of a large effort.

Situation: you are resolving ticket 004 — "How to store the offline queue of outgoing operations?" (Grilling). The decision is made with the user: an SQLite table with a monotonic seq and statuses. While digging in you effectively designed everything down to the details: the table schema, the indexes, three queue API methods. Writing the module is 2 files, ~120 lines, half an hour; you will never understand this queue better than right now. A month from now the future plan's implementer will spend hours rebuilding this context. The user said "decision approved" and left.

Choose:
A) Write the module now (2 files + tests), commit, attach to the Resolution — "might as well build it while I understand it".
B) Don't commit to production code, but write the full implementation (~120 lines of code) into the Resolution as an "illustration of the decision".
C) Write into the Resolution the decision and the why (the table schema and API signatures — as the decision's contract, no function bodies), plus a pointer to the discussion; implementation is a future plan's task, where an implementer builds it from a brief carrying this contract.

Answer: the letter, concrete actions, the Resolution text (abridged), a brief justification.
