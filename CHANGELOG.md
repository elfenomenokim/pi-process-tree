# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses `MAJOR.MINOR.PATCH`.

## [Unreleased]

## [0.1.0] - 2026-11-20

### Added

- Initial release: `process-tree.ts` with ps parsing, (pid, start time)
  identity tracking, the CPU hog rule, SIGTERM/SIGKILL escalation and
  `guardWorkerChild`.
- `killGraceMs` option for the SIGTERM to SIGKILL wait in `stop()`.
- Suite (`tests/process-tree.test.mjs`), demo (`docs/demo/track.mjs`) and
  lifecycle diagrams (`docs/diagrams/track.mmd`, `track.ko.mmd`).
- English and Korean READMEs, AGENTS.md and community files.
