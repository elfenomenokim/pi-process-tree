# Contributing to pi-process-tree

Fixes and reports are welcome. You do not need to ask before opening a pull request for a bug fix.

## Before you start

- **A wrong signal:** open an [issue](https://github.com/elfenomenokim/pi-process-tree/issues/new/choose)
  with the `ps` sample (fake pids are fine), the options, and which pids were signalled versus
  which should have been. Identity bugs reproduce from the sample alone.
- **A hog-rule change:** describe the streak that fails today. Thresholds, windows and gaps are
  one design, not three independent knobs.
- **A security problem:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

```sh
git clone https://github.com/elfenomenokim/pi-process-tree
cd pi-process-tree
npm test
```

`npm test` runs the suite: synthetic fixtures plus one live grandchild reap with throwaway
`sleep` processes. No dependencies to install. Node 22.18 or newer is required.

## What a good patch has

- **The `ps` sample and the options** that show the bug, before and after the fix.
- **No signalled pid without a fresh identity check**, and never pid <= 1, the root,
  this process or its parent.
- **A line under Unreleased** in [CHANGELOG.md](CHANGELOG.md) when a user will notice.
- **The platforms you did not test** written in the pull request. macOS on Node 22.23.5
  has been exercised; Windows is a no-op by design.

## Review

Every pull request runs an automatic OpenCode review. Ask for another pass with `@codex review` or
`@claude review` in a comment. If a finding looks wrong, say why in the pull request.

## Style

Keep the library to one file with no dependencies. Keep demo processes throwaway and the
owner's pids out of committed files.

## Licence

Contributions are licensed under the MIT licence in [LICENSE](LICENSE).
