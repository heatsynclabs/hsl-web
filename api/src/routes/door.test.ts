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

  // Deleting the credential outright, which is the foreign key rather than the
  // revoke route. What revoking does is in the fifth audit block below.
  test('deleting a credential outright takes its placement with it', async () => {
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

  test('commands are handed over in the order they were asked for', async () => {
    const bearer = await makeServiceToken()
    const opener = await makeMember({ doorAccess: true })
    await reported()

    // Two commands half a minute apart, both inside the two minute window that
    // expires one nobody claimed. Run in the other order the door ends up
    // locked when somebody asked for it to be unlocked, which is the difference
    // between a member getting in and not.
    for (const [action, ago] of [
      ['lock', 60],
      ['unlock', 30],
    ] as const) {
      await sql`
        insert into door_commands (controller_id, action, door, requested_by, requested_at)
        values ('openaccess', ${action}, 'front', ${opener.id}, now() - ${`${ago} seconds`}::interval)`
    }

    const answer = await call(app, '/door/commands', { bearer, controller: CONTROLLER })
    const { commands } = (await answer.json()) as { commands: Array<{ action: string }> }
    assert.deepEqual(
      commands.map((one) => one.action),
      ['lock', 'unlock'],
    )
  })

  test('a door the controller stopped reporting does not leave the rest stale', async () => {
    const member = await makeMember()
    const cookie = await signIn(app, member.email)
    const bearer = await makeServiceToken()

    await call(app, '/door/state', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: { doors: { front: 'locked', rear: 'locked' }, capabilities: ['open'] },
    })
    // The lab renames a door, or moves to a controller with one. The row for
    // the old name would sit there with an old timestamp and make the whole
    // controller read as stale forever.
    await call(app, '/door/state', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: { doors: { front: 'unlocked' }, capabilities: ['open'] },
    })

    const state = (await (await call(app, '/api/door', { cookie })).json()) as Array<{
      doors: Record<string, string>
      stale: boolean
    }>
    assert.deepEqual(state[0]?.doors, { front: 'unlocked' })
    assert.equal(state[0]?.stale, false)
  })

  test('freshness is measured by this API, not by the clock on the lab host', async () => {
    const member = await makeMember()
    const cookie = await signIn(app, member.email)
    const bearer = await makeServiceToken()

    await call(app, '/door/state', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: {
        doors: { front: 'locked' },
        capabilities: ['open'],
        // A lab host whose clock is a day out. Believing it makes the door
        // permanently stale, or permanently fresh, neither of which is a
        // reading of anything.
        reportedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    })

    const state = (await (await call(app, '/api/door', { cookie })).json()) as Array<{ stale: boolean }>
    assert.equal(state[0]?.stale, false)
  })

  test('a placement for a card that is not there does not lose the batch', async () => {
    const bearer = await makeServiceToken()
    const holder = await makeMember({ doorAccess: true })
    const [real] = await sql<Array<{ id: string }>>`
      insert into credentials (token, member_id) values ('0004B1C7', ${holder.id}) returning id`

    const answer = await call(app, '/door/placements', {
      method: 'POST',
      bearer,
      controller: CONTROLLER,
      body: {
        placements: [
          { cardId: '00000000-0000-4000-8000-000000000000', placement: { slot: 1 } },
          { cardId: real?.id, placement: { slot: 2 } },
        ],
      },
    })

    assert.equal(answer.status, 200)
    const rows = await sql<Array<{ credentialId: string }>>`select credential_id from door_placements`
    assert.deepEqual(
      rows.map((row) => row.credentialId),
      [real?.id],
    )
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

describe('the second audit, on the service boundary', () => {
  beforeEach(reset)

  test('guessing at a service token secret is counted and then refused', async () => {
    await makeServiceToken('door-front', ['door'])

    // The id is a name somebody can guess. Verifying the secret costs 19 MiB
    // and tens of milliseconds, so without a count this is a way to spend the
    // container's memory limit from outside.
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await call(app, '/door/cards', { bearer: 'door-front.wrong', controller: CONTROLLER })
    }

    const answer = await call(app, '/door/cards', { bearer: 'door-front.wrong', controller: CONTROLLER })
    assert.equal(answer.status, 429)
  })

  test('a door service polling every five seconds never meets that count', async () => {
    const bearer = await makeServiceToken()

    for (let tick = 0; tick < 20; tick += 1) {
      const answer = await call(app, '/door/commands', { bearer, controller: CONTROLLER })
      assert.equal(answer.status, 200, `tick ${tick} was refused`)
    }
  })
})

/**
 * Section 5.7 runs the old controller and the new one side by side for a week.
 * Two simulators and two controller ids exercise it on a laptop, and until this
 * pass nobody had.
 */
describe('the fifth audit, with two controllers reporting', () => {
  beforeEach(reset)

  async function reportedBy(controller: string, ago = 0): Promise<void> {
    const at = new Date(Date.now() - ago * 1000).toISOString()
    for (const door of ['front', 'rear']) {
      await sql`
        insert into door_state (controller_id, door, state, capabilities, reported_at)
        values (${controller}, ${door}, 'locked', ${['open', 'lock', 'unlock', 'alarm']}, ${at})`
    }
  }

  /** A card on two controllers, as the week of running both would leave it. */
  async function cardOnBothControllers(): Promise<{ cookie: string; cardId: string }> {
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

    for (const controller of ['old-board', 'new-board']) {
      await call(app, '/door/placements', {
        method: 'POST',
        bearer,
        controller,
        body: { placements: [{ cardId: issued.id, placement: { slot: 37, mask: 1, tag: '0004B1C7' } }] },
      })
    }
    assert.equal((await sql`select credential_id from door_placements`).length, 2)
    return { cookie, cardId: issued.id }
  }

  test('revoking a card clears its placement on every controller', async () => {
    const { cookie, cardId } = await cardOnBothControllers()

    const answer = await call(app, `/api/credentials/${cardId}`, { method: 'DELETE', cookie })
    assert.equal(answer.status, 204)

    assert.equal(
      (await sql`select controller_id from door_placements`).length,
      0,
      'a revoked card kept a placement, so the admin list still reports it on both boards',
    )
  })

  test('a revoked card is not reported as still sitting on a controller', async () => {
    const { cookie, cardId } = await cardOnBothControllers()
    await call(app, `/api/credentials/${cardId}`, { method: 'DELETE', cookie })

    const cards = (await (await call(app, '/api/credentials', { cookie })).json()) as Array<{
      token: string
      active: boolean
      placedOn: string[]
    }>
    assert.equal(cards[0]?.active, false)
    assert.deepEqual(cards[0]?.placedOn, [])
  })

  test('a pass still in flight cannot put a revoked card back', async () => {
    const bearer = await makeServiceToken('door-old', ['door'])
    const { cookie, cardId } = await cardOnBothControllers()
    await call(app, `/api/credentials/${cardId}`, { method: 'DELETE', cookie })

    // The pass read the card list before the revoke and reports where it put
    // the card after it. Without a check on this side the row comes back and
    // nothing ever removes it again.
    const answer = await call(app, '/door/placements', {
      method: 'POST',
      bearer,
      controller: 'old-board',
      body: { placements: [{ cardId, placement: { slot: 37, mask: 1, tag: '0004B1C7' } }] },
    })
    assert.equal(answer.status, 200)
    assert.equal((await sql`select controller_id from door_placements`).length, 0)
  })

  test('a command with two controllers reporting asks which one, rather than reading as a down link', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reportedBy('old-board')
    await reportedBy('new-board')

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front' },
    })

    // 503 is what this API says when the database or the lab link is down.
    // Spending it on a caller who has not said which controller buries that.
    assert.equal(answer.status, 400)
    const { error } = (await answer.json()) as { error: string }
    assert.match(error, /old-board/)
    assert.match(error, /new-board/)
    assert.equal((await sql`select id from door_commands`).length, 0)
  })

  test('naming a controller that is not there says so, and names the ones that are', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reportedBy('old-board')

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front', controllerId: 'typo-board' },
    })

    assert.equal(answer.status, 404)
    const { error } = (await answer.json()) as { error: string }
    assert.match(error, /typo-board/)
    assert.match(error, /old-board/)
  })

  test('a controller that has never reported is still a link that is down', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)

    const answer = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front' },
    })
    assert.equal(answer.status, 503)
  })

  test('each controller is commanded on its own, and one going stale does not stop the other', async () => {
    const opener = await makeMember({ doorAccess: true })
    const cookie = await signIn(app, opener.email)
    await reportedBy('old-board', 3600)
    await reportedBy('new-board')

    const stale = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front', controllerId: 'old-board' },
    })
    assert.equal(stale.status, 503)

    const live = await call(app, '/api/door/command', {
      method: 'POST',
      cookie,
      body: { action: 'open', door: 'front', controllerId: 'new-board' },
    })
    assert.equal(live.status, 202)

    const queued = await sql<Array<{ controllerId: string }>>`
      select controller_id from door_commands`
    assert.deepEqual(
      queued.map((row) => row.controllerId),
      ['new-board'],
    )
  })
})
