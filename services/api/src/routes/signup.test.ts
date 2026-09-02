import { user, waivers } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, beforeEach, expect, it } from 'vitest'

import type { Harness } from '../test-support/harness.ts'
import { createHarness, describeDatabase } from '../test-support/harness.ts'

/**
 * Joining. The account, the chosen tier and the waiver arrive together, and the
 * password is hashed by the one thing that hashes passwords here.
 */
describeDatabase('signing up', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  const joining = {
    name: 'A New Member',
    email: 'joining@example.test',
    password: 'a long enough password',
    phone: '555 0100',
    memberLevel: 25 as const,
    waiverAccepted: true as const,
  }

  beforeEach(async () => {
    await harness.reset()
  })

  afterAll(async () => {
    await harness.close()
  })

  it('creates the member with the fields they gave', async () => {
    const response = await client.api.signup.$post({ json: joining })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect('email' in body ? body.email : '').toBe(joining.email)

    const rows = await harness.db.select().from(user).where(eq(user.email, joining.email))
    expect(rows[0]?.phone).toBe('555 0100')
    expect(rows[0]?.memberLevel).toBe(25)
  })

  it('records the waiver they accepted', async () => {
    const response = await client.api.signup.$post({ json: joining })
    const body = await response.json()
    const id = 'id' in body ? body.id : ''

    const signed = await harness.db.select().from(waivers).where(eq(waivers.userId, id))
    expect(signed).toHaveLength(1)
    expect(signed[0]?.documentRef).toBe('signup-online-v1')

    const rows = await harness.db.select().from(user).where(eq(user.id, id))
    expect(rows[0]?.waiver).not.toBeNull()
  })

  it('signs the new member in, so they land on their own record', async () => {
    const response = await client.api.signup.$post({ json: joining })
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')

    const me = await client.api.me.$get({}, { headers: { cookie } })
    expect(me.status).toBe(200)
  })

  it('gives a new member no roles at all', async () => {
    const response = await client.api.signup.$post({ json: joining })
    const body = await response.json()
    const rows = await harness.db
      .select()
      .from(user)
      .where(eq(user.id, 'id' in body ? body.id : ''))

    expect(rows[0]?.admin).toBe(false)
    expect(rows[0]?.instructor).toBe(false)
    expect(rows[0]?.accountant).toBe(false)
    expect(rows[0]?.cardAccess).toBe(false)
    expect(rows[0]?.orientation).toBeNull()
  })

  it('refuses a second account for the same email address', async () => {
    await client.api.signup.$post({ json: joining })

    const response = await client.api.signup.$post({ json: joining })

    expect(response.status).toBe(409)
    const rows = await harness.db.select().from(user).where(eq(user.email, joining.email))
    expect(rows).toHaveLength(1)
  })

  it('refuses a signup that does not accept the waiver', async () => {
    const response = await harness.app.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...joining, waiverAccepted: false }),
    })

    expect(response.status).toBe(400)
    expect(await harness.db.select().from(user)).toHaveLength(0)
  })

  it('refuses a signup that tries to hand itself a role', async () => {
    const response = await harness.app.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...joining, admin: true }),
    })

    expect(response.status).toBe(400)
    expect(await harness.db.select().from(user)).toHaveLength(0)
  })

  it('refuses a tier nobody offers', async () => {
    const response = await harness.app.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...joining, memberLevel: 42 }),
    })

    expect(response.status).toBe(400)
  })

  it('lets the new member sign in again with the password they chose', async () => {
    await client.api.signup.$post({ json: joining })

    const signedIn = await harness.auth.api.signInEmail({
      body: { email: joining.email, password: joining.password },
      returnHeaders: true,
    })

    const cookie = signedIn.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')
    const me = await client.api.me.$get({}, { headers: { cookie } })

    expect(me.status).toBe(200)
  })
})
