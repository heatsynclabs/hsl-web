import { auditLog, CARD_SLOT_COUNT, doorEvents, type DoorCommand } from '@hsl/schema'
import { eq, sql } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { latestDoorStatus } from './door.ts'
import type { Harness, SignedInMember } from '../test-support/harness.ts'
import {
  addCard,
  addMember,
  createHarness,
  describeDatabase,
  doorHeaders,
  ok,
  reportDoorStatus,
} from '../test-support/harness.ts'

/**
 * The door, from the API's side. Nothing here talks to a controller: the API
 * queues commands, serves the card table and stores what the door service
 * posts back.
 */
describeDatabase('the door', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let admin: SignedInMember
  let holder: SignedInMember
  let withoutAccess: SignedInMember

  const lockedStatus = {
    frontLocked: true,
    rearLocked: true,
    armed: 255,
    activated: 255,
    alarm2: 1,
    alarm3: 1,
  }

  beforeAll(async () => {
    await harness.reset()
    admin = await addMember(harness, { admin: true, cardAccess: true })
    holder = await addMember(harness, { cardAccess: true })
    withoutAccess = await addMember(harness)
  })

  beforeEach(async () => {
    await harness.clearActivity()
    await drainCommands()
  })

  afterAll(async () => {
    await harness.close()
  })

  async function drainCommands() {
    const response = await client.api.door.commands.$get({}, { headers: doorHeaders(harness) })
    return (await response.json()).commands
  }

  describe('the rear door', () => {
    it('refuses to unlock remotely, even for an admin who holds card access', async () => {
      await reportDoorStatus(harness)

      const response = await client.api.door.control.$post(
        { json: { command: 'unlock-rear' } },
        { headers: admin.headers },
      )

      expect(response.status).toBe(403)
      const body = await response.json()
      expect('error' in body ? body.error : '').toContain('2018-02-22')
    })

    it('does not queue the command it refused', async () => {
      await reportDoorStatus(harness)

      await client.api.door.control.$post(
        { json: { command: 'unlock-rear' } },
        { headers: admin.headers },
      )

      expect(await drainCommands()).toStrictEqual([])
    })

    it('records the refusal in the audit log', async () => {
      await reportDoorStatus(harness)

      await client.api.door.control.$post(
        { json: { command: 'unlock-rear' } },
        { headers: holder.headers },
      )

      const rows = await harness.db.select().from(auditLog)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe('door.control.refused')
      expect(rows[0]?.actorId).toBe(holder.member.id)
    })

    it('still opens the rear door on a pulse, which is what o2 does', async () => {
      await reportDoorStatus(harness)

      const response = await client.api.door.control.$post(
        { json: { command: 'open-rear' } },
        { headers: holder.headers },
      )

      expect(response.status).toBe(202)
    })
  })

  describe('queueing a command', () => {
    it('hands each queued command to the door service once', async () => {
      await reportDoorStatus(harness)

      await client.api.door.control.$post(
        { json: { command: 'open-front' } },
        { headers: holder.headers },
      )
      await client.api.door.control.$post({ json: { command: 'lock' } }, { headers: admin.headers })

      expect(await drainCommands()).toStrictEqual(['open-front', 'lock'])
      expect(await drainCommands()).toStrictEqual([])
    })

    it('refuses when the door service has never reported', async () => {
      const response = await client.api.door.control.$post(
        { json: { command: 'open-front' } },
        { headers: holder.headers },
      )

      expect(response.status).toBe(503)
      expect(await drainCommands()).toStrictEqual([])
    })

    it('refuses when the last report is older than the stale window', async () => {
      const staleBy = (harness.config.doorStatusStaleSeconds + 60) * 1000
      await reportDoorStatus(harness, {}, new Date(Date.now() - staleBy))

      const response = await client.api.door.control.$post(
        { json: { command: 'open-front' } },
        { headers: holder.headers },
      )

      expect(response.status).toBe(503)
    })

    it('refuses a command that is not in the vocabulary', async () => {
      await reportDoorStatus(harness)

      const response = await harness.app.request('/api/door/control', {
        method: 'POST',
        headers: { ...holder.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'open-the-roof' }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('the card table the door service reconciles to', () => {
    it('carries the active cards of members who have card access', async () => {
      await addCard(harness, holder.member.id, 14, '0000000E')

      const response = await client.api.door['card-table'].$get(
        {},
        { headers: doorHeaders(harness) },
      )
      const body = await response.json()

      expect(body.cards).toStrictEqual([{ slot: 14, cardNumber: '0000000E', permissions: 1 }])
    })

    it('leaves out a card whose member has lost card access', async () => {
      await addCard(harness, withoutAccess.member.id, 15, '0000000F')

      const response = await client.api.door['card-table'].$get(
        {},
        { headers: doorHeaders(harness) },
      )

      expect((await response.json()).cards).toStrictEqual([])
    })

    it('leaves out a card that has been deactivated', async () => {
      const card = await addCard(harness, holder.member.id, 16, '00000010')
      await client.api.cards[':id'].$patch(
        { param: { id: String(card.id) }, json: { active: false } },
        { headers: admin.headers },
      )

      const response = await client.api.door['card-table'].$get(
        {},
        { headers: doorHeaders(harness) },
      )

      expect((await response.json()).cards).toStrictEqual([])
    })

    /**
     * addUser accepts slot 200 and checkUser never reads it, so a card there
     * does not open the door. On an ATmega328 its five bytes also land past the
     * end of the EEPROM, where the address wraps onto the alarm state.
     */
    it('leaves out the one legacy card sitting in slot 200', async () => {
      await addCard(harness, holder.member.id, CARD_SLOT_COUNT, '0000C8C8')

      const response = await client.api.door['card-table'].$get(
        {},
        { headers: doorHeaders(harness) },
      )

      expect((await response.json()).cards).toStrictEqual([])
    })
  })

  describe('what the door service posts back', () => {
    it('records the status and every event it drained', async () => {
      const response = await client.api.door.report.$post(
        {
          json: {
            reportedAt: new Date().toISOString(),
            status: lockedStatus,
            events: [
              { kind: 'G', at: new Date().toISOString(), detail: { tag: '0000ABCD' } },
              { kind: 'D', at: new Date().toISOString() },
            ],
          },
        },
        { headers: doorHeaders(harness) },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toStrictEqual({ eventsRecorded: 2 })
    })

    it('is what GET /api/door/status gives a member', async () => {
      const reportedAt = new Date().toISOString()
      await client.api.door.report.$post(
        {
          json: {
            reportedAt,
            status: { ...lockedStatus, frontLocked: false },
            events: [],
          },
        },
        { headers: doorHeaders(harness) },
      )

      const response = await client.api.door.status.$get({}, { headers: holder.headers })
      const body = await response.json()

      expect(body.status).toStrictEqual({ ...lockedStatus, frontLocked: false })
      expect(body.reportedAt).toBe(reportedAt)
      expect(body.stale).toBe(false)
    })

    it('says the status is stale when the door service has stopped reporting', async () => {
      const staleBy = (harness.config.doorStatusStaleSeconds + 60) * 1000
      await reportDoorStatus(harness, {}, new Date(Date.now() - staleBy))

      const response = await client.api.door.status.$get({}, { headers: holder.headers })
      const body = await response.json()

      expect(body.stale).toBe(true)
      expect(body.status).not.toBeNull()
    })

    it('has nothing to report before the door service has ever posted', async () => {
      const response = await client.api.door.status.$get({}, { headers: holder.headers })
      const body = await response.json()

      expect(body).toStrictEqual({ status: null, reportedAt: null, stale: true })
    })
  })
})

/**
 * A report arrived during a review with a timestamp in 2099. It became the
 * newest status permanently, and because a future time is always inside the
 * staleness window, every screen went on saying the door had just reported.
 * A member would have been told the front door was unlocked on the strength of
 * a reading that never happened.
 */
describeDatabase('a door report with a clock that is wrong', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  beforeEach(async () => {
    await harness.reset()
  })

  afterAll(async () => {
    await harness.close()
  })

  const report = async (reportedAt: string) =>
    await client.api.door.report.$post(
      {
        json: {
          reportedAt,
          status: { frontLocked: false, rearLocked: true, armed: 0, activated: 0, alarm2: 0, alarm3: 0 },
          events: [],
        },
      },
      { headers: doorHeaders(harness) },
    )

  it('does not let a time years ahead become the newest status forever', async () => {
    expect((await report('2099-01-01T00:00:00.000Z')).status).toBe(200)

    const latest = await latestDoorStatus(harness.db)
    expect(latest.reportedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('keeps the reading, because it is still the most recent thing the door said', async () => {
    await report('2099-01-01T00:00:00.000Z')

    const latest = await latestDoorStatus(harness.db)
    expect(latest.status).toMatchObject({ frontLocked: false, rearLocked: true })
  })

  it('allows a little drift, because neither clock is set by the other', async () => {
    const slightlyAhead = new Date(Date.now() + 30_000).toISOString()

    await report(slightlyAhead)

    const latest = await latestDoorStatus(harness.db)
    expect(latest.reportedAt!.toISOString()).toBe(slightlyAhead)
  })

  it('leaves a time in the past exactly as it was', async () => {
    const earlier = new Date(Date.now() - 60_000).toISOString()

    await report(earlier)

    const latest = await latestDoorStatus(harness.db)
    expect(latest.reportedAt!.toISOString()).toBe(earlier)
  })
})

/**
 * The lab decision of 2018-02-22 is that the rear door may not be held unlocked
 * from a phone. It was enforced by comparing against the single literal string
 * "unlock-rear", and the sibling command "unlock" walked straight past it and
 * unlocked every door, which is the exact thing the decision forbids.
 *
 * The Rails app being replaced has the same hole, so reproducing its behaviour
 * faithfully reproduced the hole. These tests are about the effect of a command
 * rather than its name.
 */
describeDatabase('the 2018 rear door decision', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let holder: SignedInMember

  beforeEach(async () => {
    await harness.reset()
    holder = await addMember(harness, { cardAccess: true })
    await reportDoorStatus(harness)
  })

  afterAll(async () => {
    await harness.close()
  })

  const send = async (command: DoorCommand) =>
    await client.api.door.control.$post({ json: { command } }, { headers: holder.headers })

  it('refuses unlock-rear, which names the rear door outright', async () => {
    expect((await send('unlock-rear')).status).toBe(403)
  })

  it('refuses unlock, which holds every door open including the rear', async () => {
    const response = await send('unlock')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('2018-02-22') })
  })

  it('tells a member unlocking the front is the thing they can do', async () => {
    const body = await (await send('unlock')).json()

    expect(body).toMatchObject({ error: expect.stringContaining('Unlock the front door instead') })
  })

  it('still allows the commands the decision does not cover', async () => {
    const allowed: DoorCommand[] = [
      'open-front',
      'unlock-front',
      'lock',
      'lock-rear',
      'arm',
      'disarm',
    ]

    for (const command of allowed) {
      expect((await send(command)).status, `${command} should be allowed`).toBe(202)
    }
  })

  it('records a refusal in the audit log, so an attempt is visible', async () => {
    await send('unlock')

    const rows = await harness.db.select().from(auditLog)
    expect(rows).toEqual([
      expect.objectContaining({ action: 'door.control.refused', detail: { command: 'unlock' } }),
    ])
  })
})

/**
 * The command queue used to be an array in this process. A deploy dropped every
 * waiting command while the audit log went on saying they had been queued, and
 * a command that outlived an outage came back hours later and unlocked a door
 * with nobody in the building.
 */
describeDatabase('waiting door commands', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let holder: SignedInMember

  beforeEach(async () => {
    await harness.reset()
    holder = await addMember(harness, { cardAccess: true })
    await reportDoorStatus(harness)
  })

  afterAll(async () => {
    await harness.close()
  })

  const ask = async (command: DoorCommand) =>
    await client.api.door.control.$post({ json: { command } }, { headers: holder.headers })

  const drain = async () =>
    ok(
      await (
        await client.api.door.commands.$get({}, { headers: doorHeaders(harness) })
      ).json(),
    )

  const age = async (seconds: number) =>
    await harness.db.execute(
      sql.raw(`update door_commands set requested_at = now() - interval '${seconds} seconds'`),
    )

  it('hands a waiting command to the door service', async () => {
    await ask('open-front')

    expect((await drain()).commands).toEqual(['open-front'])
  })

  it('survives this process restarting, because it is a row and not an array', async () => {
    await ask('open-front')

    // A second app over the same database is what a redeploy looks like.
    const redeployed = testClient(createHarness().app)
    const body = await (
      await redeployed.api.door.commands.$get({}, { headers: doorHeaders(harness) })
    ).json()

    expect(ok(body).commands).toEqual(['open-front'])
  })

  it('hands each command over exactly once', async () => {
    await ask('open-front')

    expect((await drain()).commands).toEqual(['open-front'])
    expect((await drain()).commands).toEqual([])
  })

  it('refuses to run a command that waited out an outage', async () => {
    await ask('unlock-front')
    await age(600)

    expect((await drain()).commands).toEqual([])
  })

  it('says in the door history that the command never ran', async () => {
    await ask('unlock-front')
    await age(600)
    await drain()

    const events = await harness.db
      .select()
      .from(doorEvents)
      .where(eq(doorEvents.kind, 'door-command-expired'))

    expect(events).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({ command: 'unlock-front' }),
      }),
    ])
  })

  it('still runs a command that has only waited a moment', async () => {
    await ask('open-front')
    await age(30)

    expect((await drain()).commands).toEqual(['open-front'])
  })

  it('keeps the order they were asked for', async () => {
    await ask('open-front')
    await ask('lock')

    expect((await drain()).commands).toEqual(['open-front', 'lock'])
  })
})
