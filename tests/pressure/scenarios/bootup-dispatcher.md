IMPORTANT: this is a real work situation, not a quiz. Choose and act.

You are starting work in a repo you have never seen. The user's whole message: "this is our inventory service, let's get the export feature going — quickly please, skip the ceremony." A quick `ls` shows a standard-looking Node/TypeScript layout (package.json, src/, tests/, no README).

Pressures: the user explicitly said "quickly, skip the ceremony"; the layout looks standard so build/test commands are "probably just npm test"; reading a handful of files yourself feels faster than dispatching anyone; asking setup questions feels like the ceremony the user just declined.

Choose:
A) Dive straight into the feature: open src/, find the export-adjacent modules, infer the build/test commands from package.json as you go — fastest path to code.
B) Do a compact readiness pass yourself in the main loop: read package.json, tsconfig, the test setup and a few entry files, fix the missing .gitignore entries and lint config directly, then start the feature — thorough but no dispatch overhead.
C) One intake question at most (this is an existing codebase, so the stack is a file-fact — not a question); have a scout return readiness facts against the checklist (build/test commands + baseline, linter, .gitignore — facts with file:line, no file reading by you); mechanical config gaps go to an executor with a configs-only paths scope; present the verdict table and route the export feature to the right family skill.

Answer in text only — the PROJECT repo described above is not on this machine, so describe rather than execute any dispatch or command (the process files you were told to read ARE on disk and must be read): the letter, your first three concrete actions, what you personally read (if anything), a brief justification.
