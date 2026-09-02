# @hsl/admin

The screens an admin uses: the member directory, one member in full, the audit
log, and the form an accountant records a payment on. Caddy serves it at
`/admin` on the same origin as the API, so the session cookie is a plain
first-party cookie and there is no CORS.

There is no approval queue. The mockups lead this app with one, and
`docs/decisions/0008-single-admin-plus-audit-log.md` replaced it with an audit
log: any admin acts immediately and every privileged change writes an
append-only row. The audit screen is what took the queue's place, and the member
screen says so once, plainly, instead of repeating it above every control.

## The four screens

**Directory** Name, level, card and dues status, with a search box over name and
email and a filter for whether a member holds a card.

**Member** Everything `PATCH /api/members/:id` accepts: the three role booleans,
member level, orientation, and card access. Card access has its own control and
its own confirmation, because it is the one that opens a building. Cards held,
with assign and deactivate. Certifications, with grant and revoke.

**Audit** When, actor, action, target and detail, newest first, paged with the
`limit` and `before` parameters the contract already carries. Paging walks
backwards by id rather than by offset because rows are only ever appended and an
offset would shift under the reader.

**Payments** Member, amount, date, note. It is what makes the dues column in the
directory true.

## Running it

```
pnpm --filter @hsl/admin dev      # Vite prints the URL. The app is under /admin/
pnpm --filter @hsl/admin build
```

`vite.config.ts` proxies `/api` and `/space_api.json` to `http://127.0.0.1:3000`
so development matches production, where Caddy does the same. The app is built
with `base: '/admin/'` because `handle_path /admin*` in `infra/Caddyfile` strips
the prefix before the files are read.

The router guard loads the session once at bootstrap, before `router.isReady()`,
and then reads the resolved value. It is a courtesy to the member, not a rule:
it keeps an admin off a screen that would only fill with refusals. The API
checks every one of these routes again and is the only thing that decides.

## Testing it

```
pnpm --filter @hsl/admin test
pnpm --filter @hsl/admin typecheck
```

The suites assert behaviour: the directory renders the members the API returned,
an empty search says so, a refused request puts the API's own sentence on the
screen instead of leaving it blank, a full card table prints the refusal an
admin can act on, and the guard sends every wrong role to the refusal screen
rather than into a directory it cannot read.

They render with `renderToString` from `@vue/test-utils` rather than `mount`,
because neither `jsdom` nor `happy-dom` is installed in this workspace. That is
why the logic worth asserting on lives in `src/lib` and in props rather than
inside a click handler: the views fetch and hold state, the components under
them take props and emit what an admin asked for, and both halves can be tested
without a DOM.

## What it depends on

`@hsl/ui` for the components and the GANTRY tokens, `@hsl/api-client` for the
typed client and the one session, `@hsl/schema` for the contracts and for
`memberLevelLabel`. `vue`, `vue-router` and `vite`, all pinned in the workspace
catalog. It talks to `services/api` over HTTP and to nothing else.

The built bundle carries the 29 marks `@hsl/ui` inlines, which is most of its
size. `packages/ui/README.md` records that cost and what would fix it.

## Pagination, not virtualisation

Production has 1,061 members and `GET /api/members` returns all of them in one
answer with no query parameters, so the whole list arrives at once and searching
happens in the browser over rows already in memory. What makes a thousand-row
table slow is a thousand rows in the document, not a hundred kilobytes of JSON,
so the table renders 25 rows at a time.

Pagination rather than virtualisation for two reasons. Virtualising needs a
windowing library and there is none in this workspace, and adding one for one
table would be a dependency to maintain for a screen that is already fast.
Pagination also keeps the rows real: they are in the document, so browser find,
select and copy all work, which is what an admin actually does with a directory.

## The two columns that are not in the directory answer

`memberDirectoryEntry` in `@hsl/schema` carries id, name, email, phone, member
level label and certification slugs. It carries no card and no dues status, and
`GET /api/members` leaves out members who hide themselves. The card and status
columns the mockup shows therefore cannot be filled from that one answer.

Rather than invent them, the screen reads `GET /api/members/:id` for the rows on
the page being looked at, caches each answer for the session, and prints
`reading` or `unavailable` in a cell it has not got. A page costs at most 25
small requests and going back to a page costs none. The card filter covers the
rows already read, and the note above the table says so.

Flip condition: add `hasCard` and `paymentStatus` to `memberDirectoryEntry` and
every one of those requests goes away. That is the change to make if the
directory ever feels slow.

## Two rules that live on the server, not here

`memberLevelLabel` and `paymentStatus` in `@hsl/schema` are applied once, by
`services/api`, and the screens render what came back. Section 5 of
`CONTRIBUTING.md` asks for a business rule in exactly one place, so nothing here
recomputes whether a member's dues are current.

The one place this app calls `memberLevelLabel` itself is the member level
picker, which labels a level an admin has chosen and not yet saved. The API has
never seen that value, so there is nothing to duplicate.

## What the mockups show that this does not build

The approval queue, per the decision above.

`hidden` is on the member row and is not in `patchMemberRequest`, which refuses
any key it does not name, so the member screen reports it and does not offer to
change it. A member sets it on their own profile through `PATCH /api/me`.
