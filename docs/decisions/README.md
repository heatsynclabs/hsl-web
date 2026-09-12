# Decisions

Half a page each. The value is that in three years somebody can see a choice was
considered rather than defaulted into. Reversing one is fine; reversing it
without writing down what changed is not.

Rule 8 in `CONTRIBUTING.md` says when one is required: any dependency, any
architectural choice. `0000-template.md` is the shape.

| | |
| --- | --- |
| 0001 | One repository, two processes |
| 0002 | Hono and postgres.js, with no ORM and no auth framework |
| 0003 | TypeScript that runs without a build step |
| 0004 | Keep the bcrypt hashes and upgrade them on sign in |
| 0005 | The door service is outbound only |
| 0006 | The placement is opaque to the API |
| 0007 | A simulated controller, not a mock |
| 0008 | One admin acting immediately, plus an audit log |
| 0009 | The card list version is a digest, not a counter |
| 0010 | What the import carries and what it leaves behind |
| 0011 | The node test runner instead of a test framework |
| 0012 | No front end in this repository |
