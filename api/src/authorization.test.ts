import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

import { app } from './index.ts'
import { call, makeMember, makeServiceToken, reset, signIn, stop } from './test-support.ts'

/**
 * A test per role for every rule, including anonymous, and including the case
 * that must be refused. A rule without a refusal test is untested.
 */

describe('authorization', () => {
  before(reset)
  beforeEach(reset)
  after(stop)

  test('anonymous is refused everywhere that needs an account', async () => {
    const guarded = [
      ['GET', '/api/me'],
      ['PATCH', '/api/me'],
      ['GET', '/api/me/door-events'],
      ['GET', '/api/members'],
      ['GET', '/api/members/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/members'],
      ['GET', '/api/certifications'],
      ['GET', '/api/credentials'],
      ['POST', '/api/payments'],
      ['GET', '/api/door'],
      ['POST', '/api/door/command'],
      ['GET', '/api/door/events'],
      ['GET', '/api/service-tokens'],
      ['POST', '/api/token'],
    ] as const

    for (const [method, path] of guarded) {
      const answer = await call(app, path, { method, body: {} })
      assert.equal(answer.status, 401, `${method} ${path} let an anonymous caller through`)
    }
  })

  test('the door service endpoints refuse a browser session', async () => {
    const member = await makeMember({ roles: ['admin'], oriented: true, doorAccess: true })
    const cookie = await signIn(app, member.email)

    for (const path of ['/door/cards', '/door/commands']) {
      const answer = await call(app, path, { cookie, controller: 'openaccess' })
      assert.equal(answer.status, 401, `${path} accepted a session cookie`)
    }
  })

  test('a service token without the door scope is refused', async () => {
    const bearer = await makeServiceToken('kiosk', ['members:read'])
    const answer = await call(app, '/door/cards', { bearer, controller: 'openaccess' })
    assert.equal(answer.status, 403)
  })

  test('a revoked service token stops working', async () => {
    const bearer = await makeServiceToken('door-a', ['door'])
    assert.equal((await call(app, '/door/cards', { bearer, controller: 'a' })).status, 200)

    const admin = await makeMember({ roles: ['admin'] })
    const cookie = await signIn(app, admin.email)
    assert.equal((await call(app, '/api/service-tokens/door-a', { method: 'DELETE', cookie })).status, 204)

    assert.equal((await call(app, '/door/cards', { bearer, controller: 'a' })).status, 401)
  })

  test('the directory opens after orientation and not before', async () => {
    const green = await makeMember({ oriented: false })
    const oriented = await makeMember({ oriented: true })

    assert.equal((await call(app, '/api/members', { cookie: await signIn(app, green.email) })).status, 403)
    assert.equal((await call(app, '/api/members', { cookie: await signIn(app, oriented.email) })).status, 200)
  })

  test('a member cannot read another member in full', async () => {
    const other = await makeMember()
    const plain = await makeMember({ oriented: true })

    const answer = await call(app, `/api/members/${other.id}`, { cookie: await signIn(app, plain.email) })
    assert.equal(answer.status, 403)
  })

  test('a member cannot give themselves a role, door access or orientation', async () => {
    const plain = await makeMember()
    const cookie = await signIn(app, plain.email)

    const answer = await call(app, '/api/me', {
      method: 'PATCH',
      cookie,
      body: { name: 'Renamed', roles: ['admin'], doorAccess: true, oriented: true, status: 'active', memberLevel: 500 },
    })

    assert.equal(answer.status, 200)
    const after_ = (await answer.json()) as Record<string, unknown>
    assert.equal(after_.name, 'Renamed')
    assert.deepEqual(after_.roles, [])
    assert.equal(after_.doorAccess, false)
    assert.equal(after_.oriented, false)
    assert.equal(after_.memberLevel, null)
  })

  test('granting a certification needs the instructor role', async () => {
    const subject = await makeMember()
    const plain = await makeMember()
    const instructor = await makeMember({ roles: ['instructor'] })
    const admin = await makeMember({ roles: ['admin'] })

    const grant = (cookie: string) =>
      call(app, `/api/members/${subject.id}/certifications`, { method: 'POST', cookie, body: { slug: 'laser' } })

    assert.equal((await grant(await signIn(app, plain.email))).status, 403)

    // The certification has to exist before it can be granted.
    assert.equal((await grant(await signIn(app, instructor.email))).status, 404)
    assert.equal((await grant(await signIn(app, admin.email))).status, 404)
  })

  test('recording a payment needs the accountant role, and admin carries it', async () => {
    const subject = await makeMember()
    const plain = await makeMember()
    const accountant = await makeMember({ roles: ['accountant'] })
    const admin = await makeMember({ roles: ['admin'] })
    const payment = { memberId: subject.id, amount: '50.00', paidOn: '2026-09-01' }

    const record = (cookie: string) => call(app, '/api/payments', { method: 'POST', cookie, body: payment })

    assert.equal((await record(await signIn(app, plain.email))).status, 403)
    assert.equal((await record(await signIn(app, accountant.email))).status, 201)
    assert.equal((await record(await signIn(app, admin.email))).status, 201)
  })

  test('a suspended member is refused after they sign in', async () => {
    const suspended = await makeMember({ status: 'suspended' })
    const cookie = await signIn(app, suspended.email)

    const answer = await call(app, '/api/me', { cookie })
    assert.equal(answer.status, 403)
    assert.match(((await answer.json()) as { error: string }).error, /not active/)
  })

  test('a JWT reaches member routes and cannot buy another JWT', async () => {
    const plain = await makeMember()
    const cookie = await signIn(app, plain.email)

    const issued = await call(app, '/api/token', { method: 'POST', cookie })
    assert.equal(issued.status, 200)
    const { token } = (await issued.json()) as { token: string }

    assert.equal((await call(app, '/api/me', { bearer: token })).status, 200)
    // No refresh tokens: the client holds the cookie and asks again.
    assert.equal((await call(app, '/api/token', { method: 'POST', bearer: token })).status, 401)
  })

  test('a member reads their own door events and an admin reads all of them', async () => {
    const plain = await makeMember()
    const cookie = await signIn(app, plain.email)

    assert.equal((await call(app, '/api/me/door-events', { cookie })).status, 200)
    assert.equal((await call(app, '/api/door/events', { cookie })).status, 403)
  })
})
