# 0009. TypeScript pinned to 6.0.3

Date: 2026-09-01
Status: accepted

## Context

The npm `latest` tag for TypeScript is 7.0.2, the native Go compiler. It ships
without a stable programmatic compiler API. `vue-tsc` and `typescript-eslint`
both embed the compiler and feed it virtual files rather than shelling out to
`tsc`, so neither runs on 7.x. `typescript-eslint@8.69.0` declares a peer range
of `>=4.8.4 <6.1.0`.

An unpinned `pnpm add -D typescript` gets a compiler this repository cannot
type-check Vue templates with.

## Alternatives

| Option | Why not |
|---|---|
| TypeScript 7.0.2 | `vue-tsc` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` on `./lib/tsc`, and lint with type information does not run. |
| `typescript-native-bridge` shim | A single-maintainer package outside both the microsoft and vuejs organisations, versioned `6.0.3-bridge.15.tsgo.7.0.2`. Debugging it during an outage is what section 7 of the working rules exists to prevent. |

## Decision

Pin `typescript` to 6.0.3 in the workspace catalog, so every package resolves to
one version and the pin is enforceable in one line.

## Consequence

Easy: `vue-tsc` and typed linting work. One place to change the version.

Hard: the repository is behind the published latest, and anyone reading release
notes will wonder why.

Flip condition: TypeScript 7.1 ships the programmatic compiler API and `vue-tsc`
declares a peer range that includes it.
