# AGENTS.md — pi-process-tree

Instructions for a coding agent working in this repository.

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
