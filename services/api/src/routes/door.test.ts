import { auditLog, CARD_SLOT_COUNT } from '@hsl/schema'
import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import {
  addCard,
  addMember,
  createHarness,
  describeDatabase,
  doorHeaders,
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
