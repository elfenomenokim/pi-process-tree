# AGENTS.md — pi-process-tree

Instructions for a coding agent working in this repository.

## Set up for a user

Goal: the user's Node project can track a child's process tree and reap runaway descendants. This is a library, so "working" means the check below runs inside their project. macOS and Linux only.

1. Check what is present.
   - `node --version` prints `v22.18` or newer. If not: `brew install node` (macOS) or `curl -fsSL https://fnm.vercel.app/install | bash` then `fnm install 22`.
   - `ps -A -o pid=,ppid=,pcpu=,lstart= | head -1` prints a row (the library reads `ps`).
   - Find the project folder (the one with `package.json`). If there is none, ask the user where the code lives; do not create one in their home directory.
2. Install into that project: `npm install pi-process-tree`. It has no dependencies. Add `"type": "module"` to the project's `package.json` or use `.mjs` files for the `import`.
3. Nothing in this setup needs the person.
4. Prove it: save as `check.mjs` in the project and run `node check.mjs`.
   ```js
   import { spawn } from "node:child_process";
   import { trackDescendants } from "pi-process-tree";
   const root = spawn("sh", ["-c", "sleep 30 & wait"], { stdio: "ignore" });
   const t = trackDescendants(root.pid, { intervalMs: 200 });
   await new Promise((r) => setTimeout(r, 1000));
   const stopped = await t.stop();
   console.log(`reaped=${stopped.length} root-alive=${root.exitCode === null}`);
   root.kill();
   ```
   Success prints `reaped=1 root-alive=true`. Delete `check.mjs` afterwards.
5. If it fails, in this order:
   - `ERR_MODULE_NOT_FOUND ... pi-process-tree`: run from the project folder where step 2 ran.
   - `Cannot use import statement outside a module` or a `.ts` parse error: use `.mjs`, and import `"pi-process-tree"` (the package ships `process-tree.js`); Node below 22.18 cannot read the `.ts` file.
   - `reaped=0`: `ps` is blocked (container without procps or a restricted sandbox); run `ps -A -o pid=,ppid=,pcpu=,lstart=` by hand and report its error.
   - Windows: not supported.

## Layout

- `process-tree.ts` — the whole library: parsing, identity, hog rule, tracking.
- `tests/process-tree.test.mjs` — the suite; synthetic fixtures plus one live
  grandchild reap, no Pi runtime and no dependencies.
- `docs/demo/track.mjs` — the demo behind the README quick start; spawns real
  throwaway `sleep` processes only.
- `docs/diagrams/track.mmd`, `track.ko.mmd` — the lifecycle diagram sources.

## Build and test

```sh
npm test
```

`npm test` runs `node --test tests/process-tree.test.mjs`. Node 22.18 or newer
is required (it strips the types in `process-tree.ts` natively). There are no
dependencies, no build step and no linter.

## Style

- Keep the library dependency-free. Every `ps` or `kill` failure stays swallowed.
- Keep the signalling order: re-read `ps`, check (pid, start time) identity,
  then signal. Never signal pid <= 1, the root, this process or its parent.
- Keep `stop()` semantics: SIGTERM the survivors, one delayed SIGKILL after
  `killGraceMs`, still identity-checked.
- English identifiers and comments; the Korean README translates, never the code.

## Do not

- Never signal the root pid for any reason, including the hog rule.
- Never read a failed `ps` sample as "disappeared". Change nothing on failure.
- Never treat a pid that reappeared after vanishing as the same process.
- Never block the event loop waiting for `ps`; the sampler stays async.

## Verify before you attach

1. `npm test` passes: 9 tests, 0 failures.
2. `node docs/demo/track.mjs` reaps one grandchild and leaves the root alive.

## Code Review Rules

A change is a real defect when it:

- signals a pid without a fresh identity check, or ever signals pid <= 1,
  the root, this process or its parent.
- stops a hog before its streak covers the whole window, or counts samples
  more than three intervals apart toward the streak.
- mistakes an adopted orphan for a collision (or the reverse) in
  `updateRemembered`.
- drops a failed `ps` read into the remembered set, or treats an absent pid
  as a signal target.
- adds a dependency, or breaks `npm test` on Node 22.18+.

Not defects: wording, formatting, comment style, or a requested extra test.
