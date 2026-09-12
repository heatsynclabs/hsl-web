# 0011. The node test runner instead of a test framework

Date: 2026-09-11
Status: accepted

## Context

Sixty nine tests across two services. The previous attempt used Vitest, which
brought a config file per package, a watcher, a mocking library and a version to
keep in step with the rest of the toolchain.

## Alternatives

| Option | Why not |
| --- | --- |
| Vitest | Genuinely good, and its two advantages here are a watcher and `vi.mock`. Rule 4 says test the boundary rather than the mock, so the second advantage is a hazard. |
| Jest | Slower, and needs a transform to read TypeScript, which decision 0003 exists to avoid. |
| No tests | Rule 4. |

## Decision

`node --test` with `node:assert/strict`. Test files sit beside the code they
test and end in `.test.ts`. `--test-concurrency=1`, because the API suite shares
one database and truncates between tests.

The API suite needs the Postgres that `make up` starts. That is deliberate: most
of what is worth testing in the API is a refusal expressed in SQL. The door
suite needs nothing, because the simulated controller is in process and on a
socket it opens itself.

## Consequence

Easy: no configuration file, no dependency, no version. A test is a file that
imports from `node:test` and runs under the same Node that runs production.

Hard: no watcher, no snapshot testing, no built-in coverage. A failing test
reruns with `node --test src/thing.test.ts`, which is not a hardship.

Flip condition: the suite gets slow enough that a watcher would change how
somebody works, or somebody needs parallel test files against separate schemas.
