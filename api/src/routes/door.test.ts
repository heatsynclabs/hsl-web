import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'

import { sql } from '../db.ts'
import { app } from '../index.ts'
import { call, makeMember, makeServiceToken, reset, signIn, stop } from '../test-support.ts'

const CONTROLLER = 'openaccess'

async function reported(
  doors: Record<string, string> = { front: 'locked', rear: 'locked' },
  capabilities: string[] = ['open', 'lock', 'unlock', 'alarm'],
  ago = 0,
): Promise<void> {
  const at = new Date(Date.now() - ago * 1000).toISOString()
  for (const [door, state] of Object.entries(doors)) {
    await sql`
      insert into door_state (controller_id, door, state, capabilities, reported_at)
      values (${CONTROLLER}, ${door}, ${state}, ${capabilities}, ${at})
      on conflict (controller_id, door) do update
        set state = excluded.state, capabilities = excluded.capabilities,
            reported_at = excluded.reported_at`
  }
}

// File scope, because a second describe below runs after this one finishes and
// an after() inside a describe closes the pool too early for it.
after(stop)

describe('the door', () => {
  beforeEach(reset)

  test('the card list is active cards of active members who have door access', async () => {
    const bearer = await makeServiceToken()
    const withAccess = await makeMember({ doorAccess: true })
    const without = await makeMember({ doorAccess: false })
    const lapsed = await makeMember({ doorAccess: true, status: 'lapsed' })

    for (const [token, member] of [
      ['0000AAAA', withAccess],
      ['0000BBBB', without],
      ['0000CCCC', lapsed],
    ] as const) {
      await sql`insert into credentials (token, member_id) values (${token}, ${member.id})`
    }

    const answer = await call(app, '/door/cards', { bearer, controller: CONTROLLER })
    const { cards } = (await answer.json()) as { cards: Array<{ token: string; doors: string[] }> }

    assert.deepEqual(
      cards.map((card) => card.token),
      ['0000AAAA'],
    )
    assert.deepEqual(cards[0]?.doors, ['front', 'rear'])
  })

  test('the version changes when a card changes hands and not otherwise', async () => {
    const bearer = await makeServiceToken()
    const admin = await makeMember({ roles: ['admin'] })
    const holder = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, admin.email)

    const version = async (): Promise<string> =>
      ((await (await call(app, '/door/cards', { bearer, controller: CONTROLLER })).json()) as { version: string })
        .version

    const empty = await version()
    const issued = await call(app, '/api/credentials', {
      method: 'POST',
      cookie,
      body: { token: '0004B1C7', memberId: holder.id },
    })
    const card = (await issued.json()) as { id: string }

    const withCard = await version()
    assert.notEqual(withCard, empty)
    assert.equal(await version(), withCard, 'the version moved without the card list moving')

    await call(app, `/api/credentials/${card.id}`, { method: 'DELETE', cookie })
    assert.equal(await version(), empty)
  })

  test('a placement goes back out exactly as it came in', async () => {
    const bearer = await makeServiceToken()
    const holder = await makeMember({ doorAccess: true })
    const [card] = await sql<Array<{ id: string }>>`
      insert into credentials (token, member_id) values ('0004B1C7', ${holder.id}) returning id`

    // Deliberately not the shape this API would ever produce: snake case keys,
    // a nested object, a null. Nothing here is allowed to look inside or tidy.
    const placement = { slot: 37, permission_mask: 1, padded_tag: '0004B1C7', vendor: { rev: null } }

    await call(app, '/door/placements', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: { placements: [{ cardId: card?.id, placement }], removed: [] },
    })

    const answer = await call(app, '/door/cards', { bearer, controller: CONTROLLER })
    const { cards } = (await answer.json()) as { cards: Array<{ placement: unknown }> }
    assert.deepEqual(cards[0]?.placement, placement)
  })

  test('a placement written for one controller is invisible to another', async () => {
    const bearer = await makeServiceToken()
    const holder = await makeMember({ doorAccess: true })
    const [card] = await sql<Array<{ id: string }>>`
      insert into credentials (token, member_id) values ('0004B1C7', ${holder.id}) returning id`

    await call(app, '/door/placements', {
      method: 'POST',
      bearer,
      controller: 'old-board',
      body: { placements: [{ cardId: card?.id, placement: { slot: 37 } }] },
    })

    const answer = await call(app, '/door/cards', { bearer, controller: 'new-board' })
    const { cards } = (await answer.json()) as { cards: Array<{ placement: unknown }> }
    assert.equal(cards[0]?.placement, null)
  })

  test('revoking a card takes its placement with it', async () => {
    const bearer = await makeServiceToken()
    const admin = await makeMember({ roles: ['admin'] })
    const holder = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, admin.email)

    const issued = (await (
      await call(app, '/api/credentials', {
        method: 'POST',
        cookie,
        body: { token: '0004B1C7', memberId: holder.id },
      })
    ).json()) as { id: string }

    await call(app, '/door/placements', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: { placements: [{ cardId: issued.id, placement: { slot: 37 } }] },
    })
    assert.equal((await sql`select credential_id from door_placements`).length, 1)

    await sql`delete from credentials where id = ${issued.id}`
    assert.equal((await sql`select credential_id from door_placements`).length, 0)
  })

  test('a command needs door access, and a controller that has reported', async () => {
    const plain = await makeMember({ doorAccess: false })
    const opener = await makeMember({ doorAccess: true })

    const refused = await call(app, '/api/door/command', {
      method: 'POST',
      cookie: await signIn(app, plain.email),
      body: { action: 'open', door: 'front' },
    })
    assert.equal(refused.status, 403)

    const cookie = await signIn(app, opener.email)
    const noController = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front' },
    })
    assert.equal(noController.status, 503)

    await reported()
    const queued = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front' },
    })
    assert.equal(queued.status, 202)
  })

  test('a stale controller is reported as stale and refuses commands', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported({ front: 'unlocked', rear: 'locked' }, ['open'], 3600)

    const state = (await (await call(app, '/api/door', { cookie })).json()) as Array<{ stale: boolean }>
    assert.equal(state[0]?.stale, true)

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front' },
    })
    assert.equal(answer.status, 503)
    assert.match(((await answer.json()) as { error: string }).error, /Cards still open the door/)
  })

  test('a command the controller cannot run is refused, and the refusal is audited', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported({ front: 'locked' }, ['open'])

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'alarm.arm' },
    })
    assert.equal(answer.status, 409)

    const [entry] = await sql<Array<{ action: string }>>`
      select action from audit_log order by id desc limit 1`
    assert.equal(entry?.action, 'door.command.refused')
    assert.equal((await sql`select id from door_commands`).length, 0)
  })

  test('unlocking the rear door is refused above the adapter', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported()

    const rear = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'unlock', door: 'rear' },
    })
    assert.equal(rear.status, 409)
    assert.match(((await rear.json()) as { error: string }).error, /2018-02-22/)

    // Opening it pulses the strike with somebody standing there, and is allowed.
    const opened = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'rear' },
    })
    assert.equal(opened.status, 202)
  })

  test('a command nobody claimed for two minutes is recorded as never run', async () => {
    const bearer = await makeServiceToken()
    const opener = await makeMember({ doorAccess: true })
    await reported()
    await sql`
      insert into door_commands (controller_id, action, door, requested_by, requested_at)
      values (${CONTROLLER}, 'open', 'front', ${opener.id}, now() - interval '5 minutes')`

    const answer = await call(app, '/door/commands', { bearer, controller: CONTROLLER })
    const { commands } = (await answer.json()) as { commands: unknown[] }
    assert.equal(commands.length, 0)

    const [row] = await sql<Array<{ outcome: string }>>`select outcome from door_commands`
    assert.equal(row?.outcome, 'expired')

    const [event] = await sql<Array<{ kind: string; detail: { outcome: string } }>>`
      select kind, detail from door_events order by id desc limit 1`
    assert.equal(event?.kind, 'command')
    assert.equal(event?.detail.outcome, 'expired')
  })

  test('an event naming a card this system issued is linked to its holder', async () => {
    const bearer = await makeServiceToken()
    const holder = await makeMember({ doorAccess: true })
    await sql`insert into credentials (token, member_id) values ('0004B1C7', ${holder.id})`

    await call(app, '/door/events', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: {
        events: [
          { kind: 'entry', token: '0004B1C7', door: 'front' },
          { kind: 'presented', token: '0000FFFF' },
          { kind: 'not-a-kind', token: '0000EEEE' },
        ],
      },
    })

    const rows = await sql<Array<{ kind: string; token: string; memberId: string | null }>>`
      select kind, token, member_id from door_events order by id`

    assert.equal(rows.length, 2, 'a kind this system does not have was written anyway')
    assert.equal(rows[0]?.memberId, holder.id)
    assert.equal(rows[1]?.memberId, null)

    // The member sees their own entry and not the other one.
    const mine = (await (
      await call(app, '/api/me/door-events', { cookie: await signIn(app, holder.email) })
    ).json()) as { items: unknown[] }
    assert.equal(mine.items.length, 1)
  })
})

describe('defects found in audit', () => {
  beforeEach(reset)

  test('unlocking with no door named does not unlock the rear one anyway', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported()

    // The 2018 refusal is on `unlock:rear`. Leaving the door out asks the
    // controller to unlock everything, which includes the rear one, so a
    // refusal that only reads the door name is a refusal anybody can step over.
    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'unlock' },
    })

    assert.equal(answer.status, 409, 'an unlock with no door named went through')
    assert.match(((await answer.json()) as { error: string }).error, /every door at once/)
    assert.equal((await sql`select id from door_commands`).length, 0)

    // And somebody can see it was asked for.
    const [entry] = await sql<Array<{ action: string }>>`
      select action from audit_log order by id desc limit 1`
    assert.equal(entry?.action, 'door.command.refused')
  })

  test('opening with no door named is refused rather than guessing one', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported()

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open' },
    })
    assert.equal(answer.status, 400)
    assert.match(((await answer.json()) as { error: string }).error, /which door/i)
  })

  test('locking everything needs no door, because locking is the safe direction', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reported()

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'lock' },
    })
    assert.equal(answer.status, 202)
  })
})
