# Go back to the old system

The cutover is reversible for as long as the legacy host is still running and
its database has not been written to. This is the sequence.

The door keeps working throughout. Cards are on the controller, and neither
system is involved in opening a door.

## 1. Decide, and say so out loud

Going back loses everything written in the new system since cutover: profile
edits, payments recorded, cards issued, certifications granted. Look first:

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select action, count(*) from audit_log where at > '<cutover>' group by action"
```

If that is empty, going back costs nothing. If it is not, whatever it lists has
to be re-entered in the old system by hand.

## 2. Stop the door service

On the lab host:

```sh
docker compose -f compose.lab.yml down
```

Expect: cards keep working. Nothing about the building changed.

## 3. Point DNS back

Move `members.heatsynclabs.org` and `api.heatsynclabs.org` back to the legacy
host. TTL is what decides how long this takes.

## 4. Start the legacy application

On the old host, whatever starts Rails there. Check a sign-in works.

## 5. Let the old system drive the door again

The legacy application polls the controller itself. Once it is running, it owns
the card table again.

The card table on the controller is whatever the new system last wrote, which is
the same set of cards the old system has in its database, at the same slots,
because the import carried the slots and the adapter keeps them. There is
nothing to undo on the device.

## 6. Keep the new database

Do not drop it. Take a dump and keep it, because whatever was written after
cutover is in there and somebody will want to know what.

```sh
./scripts/backup.sh
```

## 7. Write down why

An ADR in `docs/decisions/`, superseding whatever said to cut over. Rule 8: a
decision reversed without a record of what changed is the expensive kind.
