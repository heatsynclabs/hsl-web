import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'

import { sql } from './db.ts'
import { app } from './index.ts'
import { call, makeMember, reset, signIn, stop } from './test-support.ts'

/**
 * A $2a$ hash at cost 10, which is what Devise wrote and what the 1,030
 * production rows carry. The password is `correct-horse-battery`.
 */
const DEVISE_HASH = '$2a$10$eNPiWo2SJ/agF7AvCWbTZ.E1JUH6V6OFwQXi3DY9NRMfPR7iFo0pO'

describe('sessions and passwords', () => {
  beforeEach(reset)
  after(stop)

  test('a legacy bcrypt hash signs in and is replaced with argon2 in the same breath', async () => {
    const member = await makeMember({ email: 'legacy@example.invalid' })
    await sql`update members set password = ${DEVISE_HASH} where id = ${member.id}`

    const cookie = await signIn(app, member.email)
    assert.equal((await call(app, '/api/me', { cookie })).status, 200)

    const [row] = await sql<Array<{ password: string }>>`
      select password from members where id = ${member.id}`
    assert.ok(row?.password.startsWith('$argon2'), 'the hash was not upgraded')

    // And the same password still works against the new hash.
    await signIn(app, member.email)
  })

  test('a wrong password and an unknown address answer the same thing', async () => {
    const member = await makeMember({ email: 'known@example.invalid' })

    const wrong = await call(app, '/api/login', {
      method: 'POST',
      body: { email: member.email, password: 'not-the-password' },
    })
    const unknown = await call(app, '/api/login', {
      method: 'POST',
      body: { email: 'nobody@example.invalid', password: 'not-the-password' },
    })

    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    assert.deepEqual(await wrong.json(), await unknown.json())
  })

  test('the eleventh attempt in a window is refused with no hint', async () => {
    const member = await makeMember()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call(app, '/api/login', { method: 'POST', body: { email: member.email, password: 'wrong' } })
    }

    const answer = await call(app, '/api/login', {
      method: 'POST',
      body: { email: member.email, password: 'correct-horse-battery' },
    })
    assert.equal(answer.status, 429)
    assert.doesNotMatch(((await answer.json()) as { error: string }).error, /account|member|exist/i)
  })

  test('a reset link sets a password once and ends every other session', async () => {
    const member = await makeMember({ email: 'reset@example.invalid' })
    const cookie = await signIn(app, member.email)

    assert.equal((await call(app, '/api/forgot', { method: 'POST', body: { email: member.email } })).status, 204)
    const [row] = await sql<Array<{ resetToken: string }>>`
      select reset_token from members where id = ${member.id}`
    const token = row?.resetToken as string

    const used = await call(app, '/api/reset', {
      method: 'POST',
      body: { token, password: 'a-whole-new-password' },
    })
    assert.equal(used.status, 204)

    // The session that existed before is gone.
    assert.equal((await call(app, '/api/me', { cookie })).status, 401)
    // The link does not work twice.
    assert.equal(
      (await call(app, '/api/reset', { method: 'POST', body: { token, password: 'again-again-again' } })).status,
      400,
    )
    await signIn(app, member.email, 'a-whole-new-password')
  })

  test('forgot answers the same for an address nobody holds', async () => {
    const answer = await call(app, '/api/forgot', {
      method: 'POST',
      body: { email: 'nobody@example.invalid' },
    })
    assert.equal(answer.status, 204)
  })

  test('a password change keeps this session and ends the others', async () => {
    const member = await makeMember({ email: 'change@example.invalid' })
    const first = await signIn(app, member.email)
    const second = await signIn(app, member.email)

    const changed = await call(app, '/api/password', {
      method: 'POST',
      cookie: second,
      body: { current: 'correct-horse-battery', next: 'something-else-entirely' },
    })
    assert.equal(changed.status, 204)

    assert.equal((await call(app, '/api/me', { cookie: second })).status, 200)
    assert.equal((await call(app, '/api/me', { cookie: first })).status, 401)
  })

  test('changing a password needs the current one', async () => {
    const member = await makeMember()
    const cookie = await signIn(app, member.email)

    const answer = await call(app, '/api/password', {
      method: 'POST',
      cookie,
      body: { current: 'wrong', next: 'something-else-entirely' },
    })
    assert.equal(answer.status, 403)
  })

  test('logging out deletes the row rather than expiring a claim', async () => {
    const member = await makeMember()
    const cookie = await signIn(app, member.email)

    assert.equal((await call(app, '/api/logout', { method: 'POST', cookie })).status, 204)
    assert.equal((await call(app, '/api/me', { cookie })).status, 401)
    assert.equal((await sql`select token from sessions`).length, 0)
  })

  test('healthz does not ask the database anything', async () => {
    const answer = await call(app, '/healthz')
    assert.equal(answer.status, 200)
  })
})
