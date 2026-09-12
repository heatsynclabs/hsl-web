import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, beforeEach, describe, test } from 'node:test'

import { sql } from '../db.ts'
import { app } from '../index.ts'
import { call, makeMember, makeServiceToken, reset, signIn, stop } from '../test-support.ts'

after(stop)

/**
 * A wrong request has to read as a wrong request. 503 is what this API says when
 * something it needed did not answer, so spending it on a mistyped URL both
 * misleads whoever typed it and buries the signal that means the database is
 * actually down.
 */
describe('what a wrong request answers', () => {
  beforeEach(reset)

  test('a path that is not a uuid is a 404 on every route that takes one', async () => {
    const admin = await makeMember({ roles: ['admin', 'instructor', 'accountant'], oriented: true })
    const cookie = await signIn(app, admin.email)
    const bearer = await makeServiceToken()
    const junk = 'not-a-uuid'

    const routes = [
      ['GET', `/api/members/${junk}`, {}],
      ['PATCH', `/api/members/${junk}`, { cookie }],
      ['DELETE', `/api/members/${junk}`, { cookie }],
      ['POST', `/api/members/${junk}/reset`, { cookie }],
      ['POST', `/api/members/${junk}/certifications`, { cookie }],
      ['DELETE', `/api/members/${junk}/certifications/laser`, { cookie }],
      ['GET', `/api/members/${junk}/payments`, { cookie }],
      ['DELETE', `/api/credentials/${junk}`, { cookie }],
    ] as const

    for (const [method, path] of routes) {
      const answer = await call(app, path, { method, cookie, body: { slug: 'laser', doorAccess: true } })
      assert.equal(answer.status, 404, `${method} ${path} answered ${answer.status}`)
    }

    const result = await call(app, `/door/commands/${junk}/result`, {
      method: 'POST',
      bearer,
      controller: 'openaccess',
      body: { outcome: 'done' },
    })
    assert.equal(result.status, 404)
  })

  test('a member id in a body that is not a uuid is a 404', async () => {
    const admin = await makeMember({ roles: ['admin', 'accountant'], oriented: true })
    const cookie = await signIn(app, admin.email)

    const card = await call(app, '/api/credentials', {
      method: 'POST',
      cookie,
      body: { token: '0004B1C7', memberId: 'not-a-uuid' },
    })
    assert.equal(card.status, 400)

    const payment = await call(app, '/api/payments', {
      method: 'POST',
      cookie,
      body: { memberId: 'not-a-uuid', amount: '25.00', paidOn: '2026-09-01' },
    })
    assert.equal(payment.status, 400)
  })

  test('a stored hash that will not decode is a refusal, not a broken API', async () => {
    const member = await makeMember({ email: 'corrupt@example.invalid' })
    await sql`update members set password = '$argon2id$corrupted' where id = ${member.id}`

    const answer = await call(app, '/api/login', {
      method: 'POST',
      body: { email: 'corrupt@example.invalid', password: 'correct-horse-battery' },
    })
    assert.equal(answer.status, 401)
  })

  test('a service token whose hash will not decode refuses every poll cleanly', async () => {
    await makeServiceToken('door-front', ['door'])
    await sql`update service_tokens set secret_hash = '$argon2id$corrupted' where id = 'door-front'`

    const answer = await call(app, '/door/cards', { bearer: 'door-front.anything', controller: 'x' })
    assert.equal(answer.status, 401)
  })

  test('an event carrying a time that is not a time is written with this API clock', async () => {
    const bearer = await makeServiceToken()

    const answer = await call(app, '/door/events', {
      method: 'POST',
      bearer,
      controller: 'openaccess',
      body: { events: [{ kind: 'entry', at: 'half past something', token: '0004B1C7' }] },
    })

    assert.equal(answer.status, 200)
    assert.deepEqual(await answer.json(), { written: 1, skipped: 0 })
    const [row] = await sql<Array<{ at: Date }>>`select at from door_events`
    assert.ok(row !== undefined && Date.now() - row.at.getTime() < 60_000)
  })

  test('a kind this system does not have is skipped and counted', async () => {
    const bearer = await makeServiceToken()
    const answer = await call(app, '/door/events', {
      method: 'POST',
      bearer,
      controller: 'openaccess',
      body: { events: [{ kind: 'teleport' }, { kind: 'entry' }] },
    })
    assert.deepEqual(await answer.json(), { written: 1, skipped: 1 })
  })

  test('a password longer than the policy is refused at signup, not hashed', async () => {
    const answer = await call(app, '/api/signup', {
      method: 'POST',
      body: {
        name: 'Long Password',
        email: 'long@example.invalid',
        password: 'x'.repeat(300),
        waiverSigned: true,
      },
    })
    assert.equal(answer.status, 400)
    assert.match(((await answer.json()) as { error: string }).error, /longer than 200/)
  })

  test('a setting that is not a number stops the process rather than reading as false', () => {
    // Number('abc') is NaN and every comparison against NaN is false, so a
    // DOOR_STALE_SECONDS nobody typed correctly would mean nothing is ever
    // stale, which is the one reading this system must not get wrong.
    const start = (env: Record<string, string>): string => {
      try {
        execFileSync(process.execPath, ['-e', 'import("./src/config.ts")'], {
          env: { ...process.env, ...env },
          stdio: 'pipe',
        })
        return 'started'
      } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? '')
      }
    }

    assert.match(start({ DOOR_STALE_SECONDS: 'soon' }), /not a whole number of seconds/)
    assert.match(start({ PORT: '0' }), /not a whole number of seconds/)
    assert.match(start({ DOORS: '  ,  ' }), /no doors/)
    assert.equal(start({ DOOR_STALE_SECONDS: '90' }), 'started')
  })
})

/**
 * The same rule as above, three shapes on, and each of these survived five
 * passes because nobody had typed the value that reaches it.
 */
describe('the sixth audit, on what a wrong value answers', () => {
  beforeEach(reset)

  const NUL = String.fromCharCode(0)

  test('a page cursor too big to be an id answers a page, not a broken database', async () => {
    const admin = await makeMember({ roles: ['admin'] })
    const cookie = await signIn(app, admin.email)

    // Number('9223372036854775807') is 9223372036854776000, because a cursor
    // past Number.MAX_SAFE_INTEGER is not the value that was typed any more.
    // Postgres refuses that for a bigint, so paging too far read as the
    // database being down. Every one of these means "from the newest".
    for (const cursor of ['9223372036854775807', '9223372036854775808', '99999999999999999999', '1e30']) {
      for (const path of ['/api/audit', '/api/door/events', '/api/me/door-events']) {
        const answer = await call(app, `${path}?before=${cursor}`, { cookie })
        assert.equal(answer.status, 200, `${path}?before=${cursor} answered ${answer.status}`)
        const { items } = (await answer.json()) as { items: unknown[] }
        assert.ok(Array.isArray(items))
      }
    }
  })

  test('a cursor that is an id still pages', async () => {
    const admin = await makeMember({ roles: ['admin'] })
    const cookie = await signIn(app, admin.email)
    await sql`insert into audit_log (actor_id, action) values (${admin.id}, 'probe.one')`
    await sql`insert into audit_log (actor_id, action) values (${admin.id}, 'probe.two')`

    const [newest] = await sql<Array<{ id: string }>>`select id from audit_log order by id desc limit 1`
    const answer = await call(app, `/api/audit?before=${newest?.id}`, { cookie })
    const { items } = (await answer.json()) as { items: Array<{ action: string }> }
    assert.deepEqual(
      items.map((row) => row.action),
      ['probe.one'],
    )
  })

  test('a body carrying a character the database cannot store is refused, not a 503', async () => {
    const admin = await makeMember({ roles: ['admin'] })
    const cookie = await signIn(app, admin.email)

    // A Postgres text column cannot hold U+0000 and postgres.js hands the value
    // straight through. It is a value this system cannot store rather than one
    // it cannot reach.
    const bodies: Array<[string, string, Record<string, unknown>]> = [
      ['POST /api/signup', '/api/signup',
        { name: `a${NUL}b`, email: 'nul@example.invalid', password: 'correct-horse-battery', waiverSigned: true }],
      ['PATCH /api/me phone', '/api/me', { phone: `555${NUL}1234` }],
      ['PATCH /api/me skills', '/api/me', { currentSkills: `weld${NUL}ing` }],
      ['PATCH /api/me name', '/api/me', { name: `Ada${NUL}Example` }],
    ]

    for (const [label, path, body] of bodies) {
      const method = path === '/api/signup' ? 'POST' : 'PATCH'
      const answer = await call(app, path, { method, cookie, body })
      assert.equal(answer.status, 400, `${label} answered ${answer.status}`)
    }

    // And nothing was written by the one that creates a row.
    assert.equal((await sql`select id from members where email = 'nul@example.invalid'`).length, 0)
  })

  test('a command result and the event recording it land together or not at all', async () => {
    const bearer = await makeServiceToken()
    const [queued] = await sql<Array<{ id: string }>>`
      insert into door_commands (controller_id, action, door)
      values ('openaccess', 'open', 'front') returning id`

    // The detail is whatever the controller put on the wire, by way of the door
    // service. This one is a value jsonb cannot hold.
    const answer = await call(app, `/door/commands/${queued?.id}/result`, {
      method: 'POST',
      bearer,
      controller: 'openaccess',
      body: { outcome: 'done', detail: { said: `ok${NUL}then` } },
    })

    const [command] = await sql<Array<{ outcome: string | null }>>`
      select outcome from door_commands where id = ${queued?.id as string}`
    const events = await sql`select id from door_events`

    if (answer.status >= 400) {
      // Then nothing may have moved, because that is what the error says.
      assert.equal(command?.outcome, null, 'the command was resolved and the caller was told it was not')
      assert.equal(events.length, 0)
    } else {
      // Or the result was taken and the event recording it is there.
      assert.equal(command?.outcome, 'done')
      assert.equal(events.length, 1)
    }
  })
})
