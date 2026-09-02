# 0011. jsdom for the Vue suites

Date: 2026-09-02
Status: accepted

## Context

The three apps and `packages/ui` render their components with `renderToString`
from `@vue/test-utils`, because Vitest 4 declares `jsdom` and `happy-dom` as
optional peers and neither was installed. A string is enough to assert what a
screen says and not enough to assert what a click does, so the admin app, which
grants roles and opens a building, had its interactions covered only by
rendering each state separately.

Card access is asked twice on purpose. Nothing proved that the second question
was reached only by answering the first.

## Alternatives

Read from the npm registry and the GitHub API on 2026-09-02.

| Option | Latest | Published | License | npm maintainers | Open issues | Why not |
|---|---|---|---|---|---|---|
| jsdom 30.0.1 | 30.0.1 | 2026-07-29 | MIT | 6 | 405 | Chosen. |
| happy-dom 20.13.2 | 20.13.2 | 2026-09-02 | MIT | 1 | 389 | Faster, and the one most Vitest projects reach for. One npm maintainer. Section 8 asks whether more than one person maintains it, and 0009 already declined a single-maintainer package on the compiler path for the same reason. |
| linkedom 0.18.13 | 0.18.13 | 2026-07-07 | ISC | 1 | 43 | Parses and serialises rather than emulating a browser. No layout, no events worth the name, so a click test would not run. One maintainer, no 1.0. |

## Decision

Pin `jsdom` to 30.0.1 in the workspace catalog and set `environment: 'jsdom'`
in the Vitest config of `packages/ui` and the three apps.

Suites that only read markup keep `renderToString`, which is faster and says
plainly that nothing is being clicked. Suites that assert on an interaction use
`mount`.

## Consequence

Easy: a test can click the button a volunteer clicks, type into the box they
type into, and assert on what came out. The admin app's confirmations are
testable as sequences rather than as states.

Hard: jsdom is slower to start than happy-dom and pulls about thirty packages
into the development install. It ships in nothing.

Flip condition: suite start-up time becomes the reason people stop running
`pnpm check`, measured, or happy-dom acquires a second maintainer.
