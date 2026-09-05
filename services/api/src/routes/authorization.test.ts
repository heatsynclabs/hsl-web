import { testClient } from 'hono/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness, SignedInMember } from '../test-support/harness.ts'
import {
  addCard,
  addCertification,
  addMember,
  createHarness,
  describeDatabase,
  doorHeaders,
  reportDoorStatus,
} from '../test-support/harness.ts'

/**
 * One test per authorization rule per role, including anonymous, and including
 * the case that must be refused. A rule with no refusal test is untested.
 *
 * The roles are independent flags rather than a ladder, the way
 * app/models/ability.rb had them. An admin passes every check here except card
 * access, which is a flag an admin grants, including to themself, and the grant
 * is audited.
 */
describeDatabase('authorization', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  let member: SignedInMember
  let oriented: SignedInMember
  let instructor: SignedInMember
  let accountant: SignedInMember
  let admin: SignedInMember
  let cardHolder: SignedInMember
  let adminWithCardAccess: SignedInMember
  let target: SignedInMember

  beforeAll(async () => {
    await harness.reset()
    member = await addMember(harness)
    oriented = await addMember(harness, { orientation: new Date() })
    instructor = await addMember(harness, { instructor: true })
    accountant = await addMember(harness, { accountant: true })
    admin = await addMember(harness, { admin: true })
    cardHolder = await addMember(harness, { cardAccess: true })
    adminWithCardAccess = await addMember(harness, { admin: true, cardAccess: true })
    target = await addMember(harness)
  })

  beforeEach(async () => {
    await harness.clearActivity()
  })

  afterAll(async () => {
    await harness.close()
  })

  describe('GET /api/me', () => {
    it('returns a member their own record', async () => {
      const response = await client.api.me.$get({}, { headers: member.headers })
      expect(response.status).toBe(200)
    })

    it('refuses an anonymous request', async () => {
      const response = await client.api.me.$get()
      expect(response.status).toBe(401)
    })
  })

  describe('PATCH /api/me', () => {
    it('lets a member edit their own contact fields', async () => {
      const response = await client.api.me.$patch(
        { json: { phone: '555 0100' } },
        { headers: member.headers },
      )
      expect(response.status).toBe(200)
    })

    it('refuses an anonymous edit', async () => {
      const response = await client.api.me.$patch({ json: { phone: '555 0100' } })
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/members', () => {
    it('returns the directory to an oriented member', async () => {
      const response = await client.api.members.$get({}, { headers: oriented.headers })
      expect(response.status).toBe(200)
    })

    it('returns the directory to an instructor', async () => {
      const response = await client.api.members.$get({}, { headers: instructor.headers })
      expect(response.status).toBe(200)
    })

    it('returns the directory to an admin', async () => {
      const response = await client.api.members.$get({}, { headers: admin.headers })
      expect(response.status).toBe(200)
    })

    it('refuses the directory to a member who has not been oriented', async () => {
      const response = await client.api.members.$get({}, { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses the directory to anonymous', async () => {
      const response = await client.api.members.$get()
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/members/:id', () => {
    it('returns one member in full to an admin', async () => {
      const response = await client.api.members[':id'].$get(
        { param: { id: target.member.id } },
        { headers: admin.headers },
      )
      expect(response.status).toBe(200)
    })

    it('refuses one member in full to an oriented member', async () => {
      const response = await client.api.members[':id'].$get(
        { param: { id: target.member.id } },
        { headers: oriented.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses one member in full to an instructor', async () => {
      const response = await client.api.members[':id'].$get(
        { param: { id: target.member.id } },
        { headers: instructor.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses one member in full to anonymous', async () => {
      const response = await client.api.members[':id'].$get({ param: { id: target.member.id } })
      expect(response.status).toBe(401)
    })
  })

  describe('PATCH /api/members/:id', () => {
    const change = { json: { memberLevel: 50 } }

    it('lets an admin change a member', async () => {
      const response = await client.api.members[':id'].$patch(
        { ...change, param: { id: target.member.id } },
        { headers: admin.headers },
      )
      expect(response.status).toBe(200)
    })

    it('refuses a member changing another member', async () => {
      const response = await client.api.members[':id'].$patch(
        { ...change, param: { id: target.member.id } },
        { headers: member.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses an instructor changing a member', async () => {
      const response = await client.api.members[':id'].$patch(
        { ...change, param: { id: target.member.id } },
        { headers: instructor.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses an accountant changing a member', async () => {
      const response = await client.api.members[':id'].$patch(
        { ...change, param: { id: target.member.id } },
        { headers: accountant.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous change', async () => {
      const response = await client.api.members[':id'].$patch({
        ...change,
        param: { id: target.member.id },
      })
      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/cards', () => {
    const card = () => ({ json: { userId: target.member.id, cardNumber: '0000ABCD' } })

    it('lets an admin assign a card', async () => {
      const response = await client.api.cards.$post(card(), { headers: admin.headers })
      expect(response.status).toBe(201)
    })

    it('refuses a member assigning a card', async () => {
      const response = await client.api.cards.$post(card(), { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses an instructor assigning a card', async () => {
      const response = await client.api.cards.$post(card(), { headers: instructor.headers })
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous assignment', async () => {
      const response = await client.api.cards.$post(card())
      expect(response.status).toBe(401)
    })
  })

  describe('PATCH /api/cards/:id', () => {
    beforeEach(async () => {
      await addCard(harness, target.member.id, 14)
    })

    it('lets an admin deactivate a card', async () => {
      const response = await client.api.cards[':id'].$patch(
        { param: { id: '14' }, json: { active: false } },
        { headers: admin.headers },
      )
      expect(response.status).toBe(200)
    })

    it('refuses a member deactivating a card', async () => {
      const response = await client.api.cards[':id'].$patch(
        { param: { id: '14' }, json: { active: false } },
        { headers: member.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous change', async () => {
      const response = await client.api.cards[':id'].$patch({
        param: { id: '14' },
        json: { active: false },
      })
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/certifications', () => {
    it('returns the tool list to any member', async () => {
      const response = await client.api.certifications.$get({}, { headers: member.headers })
      expect(response.status).toBe(200)
    })

    it('refuses the tool list to anonymous', async () => {
      const response = await client.api.certifications.$get()
      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/members/:id/certifications', () => {
    const grant = () => ({ param: { id: target.member.id }, json: { slug: 'laser' } })

    beforeEach(async () => {
      await addCertification(harness)
    })

    it('lets an instructor grant a certification', async () => {
      const response = await client.api.members[':id'].certifications.$post(grant(), {
        headers: instructor.headers,
      })
      expect(response.status).toBe(201)
    })

    it('lets an admin grant a certification', async () => {
      const response = await client.api.members[':id'].certifications.$post(grant(), {
        headers: admin.headers,
      })
      expect(response.status).toBe(201)
    })

    it('refuses a member granting a certification to somebody else', async () => {
      const response = await client.api.members[':id'].certifications.$post(grant(), {
        headers: member.headers,
      })
      expect(response.status).toBe(403)
    })

    it('refuses an accountant granting a certification', async () => {
      const response = await client.api.members[':id'].certifications.$post(grant(), {
        headers: accountant.headers,
      })
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous grant', async () => {
      const response = await client.api.members[':id'].certifications.$post(grant())
      expect(response.status).toBe(401)
    })
  })

  describe('DELETE /api/members/:id/certifications/:slug', () => {
    beforeEach(async () => {
      await addCertification(harness)
      await client.api.members[':id'].certifications.$post(
        { param: { id: target.member.id }, json: { slug: 'laser' } },
        { headers: instructor.headers },
      )
    })

    it('lets an instructor revoke a certification', async () => {
      const response = await client.api.members[':id'].certifications[':slug'].$delete(
        { param: { id: target.member.id, slug: 'laser' } },
        { headers: instructor.headers },
      )
      expect(response.status).toBe(200)
    })

    it('refuses a member revoking a certification', async () => {
      const response = await client.api.members[':id'].certifications[':slug'].$delete(
        { param: { id: target.member.id, slug: 'laser' } },
        { headers: member.headers },
      )
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous revoke', async () => {
      const response = await client.api.members[':id'].certifications[':slug'].$delete({
        param: { id: target.member.id, slug: 'laser' },
      })
      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/payments', () => {
    const payment = () => ({
      json: { userId: target.member.id, amountCents: 5000, paidOn: '2026-08-01' },
    })

    it('lets an accountant record a payment', async () => {
      const response = await client.api.payments.$post(payment(), {
        headers: accountant.headers,
      })
      expect(response.status).toBe(201)
    })

    it('lets an admin record a payment', async () => {
      const response = await client.api.payments.$post(payment(), { headers: admin.headers })
      expect(response.status).toBe(201)
    })

    it('refuses a member recording a payment', async () => {
      const response = await client.api.payments.$post(payment(), { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses an instructor recording a payment', async () => {
      const response = await client.api.payments.$post(payment(), {
        headers: instructor.headers,
      })
      expect(response.status).toBe(403)
    })

    it('refuses an anonymous payment', async () => {
      const response = await client.api.payments.$post(payment())
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/audit', () => {
    it('returns the audit log to an admin', async () => {
      const response = await client.api.audit.$get({ query: {} }, { headers: admin.headers })
      expect(response.status).toBe(200)
    })

    it('refuses the audit log to a member', async () => {
      const response = await client.api.audit.$get({ query: {} }, { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses the audit log to an accountant', async () => {
      const response = await client.api.audit.$get({ query: {} }, { headers: accountant.headers })
      expect(response.status).toBe(403)
    })

    it('refuses the audit log to anonymous', async () => {
      const response = await client.api.audit.$get({ query: {} })
      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/door/control', () => {
    const open = { json: { command: 'open-front' as const } }

    beforeEach(async () => {
      await reportDoorStatus(harness)
    })

    it('queues a command from a member who has card access', async () => {
      const response = await client.api.door.control.$post(open, {
        headers: cardHolder.headers,
      })
      expect(response.status).toBe(202)
    })

    it('refuses a member who does not have card access', async () => {
      const response = await client.api.door.control.$post(open, { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses an admin who does not have card access', async () => {
      const response = await client.api.door.control.$post(open, { headers: admin.headers })
      expect(response.status).toBe(403)
    })

    it('queues a command from an admin who has card access', async () => {
      const response = await client.api.door.control.$post(open, {
        headers: adminWithCardAccess.headers,
      })
      expect(response.status).toBe(202)
    })

    it('refuses an anonymous command', async () => {
      const response = await client.api.door.control.$post(open)
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/door/status', () => {
    it('returns the last status to any member', async () => {
      const response = await client.api.door.status.$get({}, { headers: member.headers })
      expect(response.status).toBe(200)
    })

    it('refuses the door status to anonymous', async () => {
      const response = await client.api.door.status.$get()
      expect(response.status).toBe(401)
    })
  })

  describe('the routes the door service uses', () => {
    it('serves the card table to the door credential', async () => {
      const response = await client.api.door['card-table'].$get({}, { headers: doorHeaders(harness) })
      expect(response.status).toBe(200)
    })

    it('refuses the card table to an admin session, which is not that credential', async () => {
      const response = await client.api.door['card-table'].$get({}, { headers: admin.headers })
      expect(response.status).toBe(401)
    })

    it('refuses the card table to a wrong credential', async () => {
      const response = await client.api.door['card-table'].$get(
        {},
        { headers: { authorization: 'Bearer not the door token' } },
      )
      expect(response.status).toBe(401)
    })

    it('accepts a report from the door credential', async () => {
      const response = await client.api.door.report.$post(
        {
          json: {
            reportedAt: new Date().toISOString(),
            status: {
              frontLocked: true,
              rearLocked: true,
              armed: 255,
              activated: 255,
              alarm2: 1,
              alarm3: 1,
            },
            events: [],
          },
        },
        { headers: doorHeaders(harness) },
      )
      expect(response.status).toBe(200)
    })

    it('refuses a report from an admin session', async () => {
      const response = await client.api.door.report.$post(
        {
          json: {
            reportedAt: new Date().toISOString(),
            status: {
              frontLocked: true,
              rearLocked: true,
              armed: 255,
              activated: 255,
              alarm2: 1,
              alarm3: 1,
            },
            events: [],
          },
        },
        { headers: admin.headers },
      )
      expect(response.status).toBe(401)
    })

    it('drains queued commands for the door credential', async () => {
      const response = await client.api.door.commands.$get({}, { headers: doorHeaders(harness) })
      expect(response.status).toBe(200)
    })

    it('refuses the command queue to a member with card access', async () => {
      const response = await client.api.door.commands.$get({}, { headers: cardHolder.headers })
      expect(response.status).toBe(401)
    })
  })

  /**
   * Section 4: a rule without a refusal test is untested. These three are
   * requireAdmin in the source and were the three with no case at all, so
   * deleting the middleware left every test in this service green.
   */
  describe('the admin door screens', () => {
    it('pushes the card table for an admin', async () => {
      const response = await client.api.door.sync.$post({}, { headers: admin.headers })
      expect(response.status).toBe(202)
    })

    it('refuses a card table push from a member with card access', async () => {
      const response = await client.api.door.sync.$post({}, { headers: cardHolder.headers })
      expect(response.status).toBe(403)
    })

    it('refuses a card table push from anonymous', async () => {
      expect((await client.api.door.sync.$post()).status).toBe(401)
    })

    it('returns the door history to an admin', async () => {
      const response = await client.api.door.events.$get({}, { headers: admin.headers })
      expect(response.status).toBe(200)
    })

    /**
     * Section 12: door logs are readable by the member they concern and by
     * admins, and by nobody else. There is no member-facing route yet, so this
     * is the half that has to hold.
     */
    it('refuses the door history to a member, whose own reads are in it', async () => {
      const response = await client.api.door.events.$get({}, { headers: member.headers })
      expect(response.status).toBe(403)
    })

    it('refuses the door history to anonymous', async () => {
      expect((await client.api.door.events.$get()).status).toBe(401)
    })

    it('refuses the card table view to a member who is not an admin', async () => {
      const response = await client.api.door['card-table-view'].$get(
        {},
        { headers: member.headers },
      )
      expect(response.status).toBe(403)
    })
  })

  describe('DELETE /api/members/:id', () => {
    it('refuses an anonymous removal', async () => {
      const response = await client.api.members[':id'].$delete({ param: { id: member.member.id } })
      expect(response.status).toBe(401)
    })
  })

  describe('GET /space_api.json', () => {
    it('is public', async () => {
      const response = await client['space_api.json'].$get()
      expect(response.status).toBe(200)
    })
  })

  describe('POST /api/signup', () => {
    it('is open to anyone', async () => {
      const response = await client.api.signup.$post({
        json: {
          name: 'New Member',
          email: 'joining@example.test',
          password: 'a long enough password',
          memberLevel: 25,
          waiverAccepted: true,
        },
      })
      expect(response.status).toBe(201)
    })
  })
})
