# 0003. TypeScript that runs without a build step

Date: 2026-09-11
Status: accepted

## Context

Node 24 strips TypeScript types at load, with no flag. The previous attempt
bundled each service with esbuild, and a known gap in its handover is that a
stack trace from either service points into a bundled file rather than into a
source file.

## Alternatives

| Option | Why not |
| --- | --- |
| `tsc` to `dist` | A build step, an output directory, a source map, and two places a file can be. |
| esbuild bundle | Faster to start, and the stack traces are the problem above. |
| Plain JavaScript with JSDoc | Keeps the runtime honest and makes the types harder to read than the code they describe. |

## Decision

Ship the `.ts` files and run them. `node api/src/index.ts` is the whole of it.
`tsc --noEmit` type checks in CI and never writes anything, and `typescript` is
a development dependency only.

This constrains the source: no enums, no parameter properties, no namespaces,
and every relative import carries its `.ts` extension. `erasableSyntaxOnly` in
both `tsconfig.json` files makes the compiler refuse anything type stripping
cannot handle, so the rule is enforced rather than remembered.

`typescript` is pinned to 7.0.2, the native compiler. The previous attempt
pinned 6.0.3 because `vue-tsc` and typed linting could not run on 7, and neither
of those exists here.

## Consequence

Easy: no build, no bundler, no source maps. A line number in a log is a line
number in a file. The Dockerfile copies `src` and runs it.

Hard: type stripping is Node 24 and newer, so the engine requirement is real and
`.nvmrc` matters. Startup parses TypeScript on every boot, which costs
milliseconds at this size.

Flip condition: a dependency ships something type stripping cannot load, or
startup time becomes something anybody measures.
