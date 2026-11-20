# Security policy

## Supported versions

Security fixes go into the latest release. Upgrade before reporting, in case the problem is
already fixed.

| Version | Supported |
| --- | --- |
| 0.1.0 | Yes |
| Older | No |

## Reporting a vulnerability

Report it privately, not in a public issue: use the
[Report a vulnerability](https://github.com/elfenomenokim/pi-process-tree/security/advisories/new) form on
the repository's Security tab.

Include the `ps` sample, the options, and which pid received a signal it should not have.
You get a reply within a few days.

## In scope

- A signal reaching pid 0 or 1, the tracked root, this process or its parent.
- A reused pid signalled as if it were the remembered process (identity check bypass).
- A `ps` sample, a pid or a start time from the tracked host leaving the process in a
  receipt, a note or an error.

## Not a vulnerability

- A descendant that starts and ends between two samples surviving. Sampling is a poll;
  shorten `intervalMs` instead.
- A descendant surviving on Windows. The library is a no-op there by design.

## Disclosure

Once a fix is released, the advisory is published with credit to the reporter unless they prefer
otherwise.
