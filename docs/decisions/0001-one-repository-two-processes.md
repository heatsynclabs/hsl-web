# 0001. One repository, two processes

Date: 2026-09-11
Status: accepted

## Context

The API and the door service are deployed to different hosts on different
networks and pulled on different schedules. They share one contract: the six
endpoints under `/door`. The previous attempt at this project had five packages
in a pnpm workspace with a build graph, and a change to the card list contract
touched four of them.

## Alternatives

| Option | Why not |
| --- | --- |
| Two repositories | The contract between them stops being reviewable in one diff, and the door service is the thing most likely to be edited at the same time as the endpoints it calls. |
| One process | The door service would then be reachable from the public internet, or the API would have to live on the lab network. Decision 0005 is about that. |
| A workspace with shared packages | The only thing worth sharing is a handful of type names, and sharing them costs a build step, a version, and a package that both sides have to install. They are written twice, which is thirty lines. |

## Decision

One repository. Two directories, each with its own `package.json` and its own
lockfile, installed separately and built into separate images. No workspace, no
shared package, no build graph.

## Consequence

Easy: the contract is one diff. Either service can be rewritten in another
language by somebody who reads section 4.8 of the README.

Hard: the four interface types in `door/src/adapter.ts` and the shapes in
`api/src/routes/service.ts` are written twice and can drift. The door suite is
what catches it.

Flip condition: a third consumer of the same contract appears, at which point
the shapes are worth publishing rather than repeating.
