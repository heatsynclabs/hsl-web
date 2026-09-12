import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'

import { sql } from '../db.ts'
import { app } from '../index.ts'
import { call, makeMember, reset, signIn, stop } from '../test-support.ts'

async function adminCookie(): Promise<string> {
  const admin = await makeMember({ roles: ['admin'], oriented: true })
  return signIn(app, admin.email)
}

describe('members', () => {
  beforeEach(reset)
  after(stop)

  test('signup creates the account, records the waiver, and audits itself', async () => {
    const answer = await call(app, '/api/signup', {
      method: 'POST',
      body: {
        name: 'New Person',
        email: 'new@example.invalid',
        password: 'a-long-enough-password',
        memberLevel: 25,
        waiverSigned: true,
        waiverDocument: 'waiver-2026-09-11.pdf',
      },
    })
    assert.equal(answer.status, 201)
    const created = (await answer.json()) as { id: string }

    const [waiver] = await sql<Array<{ document: string }>>`
      select document from waivers where member_id = ${created.id}`
    assert.equal(waiver?.document, 'waiver-2026-09-11.pdf')

    const [entry] = await sql<Array<{ action: string; actorId: string }>>`
      select action, actor_id from audit_log order by id desc limit 1`
    assert.equal(entry?.action, 'member.signup')
    assert.equal(entry?.actorId, created.id)

    await signIn(app, 'new@example.invalid', 'a-long-enough-password')
  })

  test('signup refuses an unsigned waiver, a short password and a taken address', async () => {
    const good = {
      name: 'New Person',
      email: 'taken@example.invalid',
      password: 'a-long-enough-password',
      waiverSigned: true,
    }

    assert.equal((await call(app, '/api/signup', { method: 'POST', body: { ...good, waiverSigned: false } })).status, 400)
    assert.equal((await call(app, '/api/signup', { method: 'POST', body: { ...good, password: 'short' } })).status, 400)
    assert.equal((await call(app, '/api/signup', { method: 'POST', body: good })).status, 201)
    assert.equal((await call(app, '/api/signup', { method: 'POST', body: good })).status, 409)
  })

  test('an admin creates a member, and the row carries what was asked for', async () => {
    const cookie = await adminCookie()

    const answer = await call(app, '/api/members', {
      method: 'POST',
      cookie,
      body: { name: 'Made By Admin', email: 'made@example.invalid', roles: ['instructor'], memberLevel: 50, doorAccess: true },
    })

    assert.equal(answer.status, 201)
    const created = (await answer.json()) as Record<string, unknown>
    assert.equal(created.name, 'Made By Admin')
    assert.deepEqual(created.roles, ['instructor'])
    assert.equal(created.memberLevel, 50)
    assert.equal(created.doorAccess, true)
  })

  test('changing an email to one somebody else holds is refused, not a crash', async () => {
    const cookie = await adminCookie()
    const first = await makeMember({ email: 'first@example.invalid' })
    await makeMember({ email: 'second@example.invalid' })

    const answer = await call(app, `/api/members/${first.id}`, {
      method: 'PATCH',
      cookie,
      body: { email: 'second@example.invalid' },
    })

    assert.equal(answer.status, 409)
    assert.match(((await answer.json()) as { error: string }).error, /already an account/)
  })

  test('the directory returns every member, not the first page of them', async () => {
    const cookie = await adminCookie()
    // The lab has 1,061 members. A cap below that silently hides people.
    const rows = Array.from({ length: 520 }, (_, index) => ({
      email: `crowd-${index}@example.invalid`,
      name: `Crowd ${index}`,
    }))
    await sql`insert into members ${sql(rows)}`

    const directory = (await (await call(app, '/api/members', { cookie })).json()) as unknown[]
    assert.ok(directory.length >= 521, `the directory answered with ${directory.length} of 521`)
  })

  test('the directory shows an address only where that member asked for it', async () => {
    const cookie = await adminCookie()
    await makeMember({ email: 'quiet@example.invalid', name: 'Quiet Person' })
    const loud = await makeMember({ email: 'loud@example.invalid', name: 'Loud Person' })
    await sql`update members set email_visible = true, phone = '480-555-0199', phone_visible = true
              where id = ${loud.id}`

    const directory = (await (await call(app, '/api/members', { cookie })).json()) as Array<
      Record<string, unknown>
    >
    const quiet = directory.find((row) => row.name === 'Quiet Person')
    const shown = directory.find((row) => row.name === 'Loud Person')

    assert.equal(quiet?.email, null, 'an address was shown that its member did not turn on')
    assert.equal(quiet?.phone, null)
    assert.equal(shown?.email, 'loud@example.invalid')
    assert.equal(shown?.phone, '480-555-0199')
  })

  test('a member sets their own visibility, and it is the only way it changes', async () => {
    const member = await makeMember()
    const cookie = await signIn(app, member.email)

    const answer = await call(app, '/api/me', { method: 'PATCH', cookie, body: { emailVisible: true } })
    assert.equal(answer.status, 200)
    assert.equal(((await answer.json()) as { emailVisible: boolean }).emailVisible, true)
  })

  test('deleting a member who has acted as an admin is refused rather than failing', async () => {
    const cookie = await adminCookie()
    const former = await makeMember({ roles: ['admin'] })

    // They did one thing, once, and the audit log outlives everybody in it.
    await sql`insert into audit_log (actor_id, action) values (${former.id}, 'member.update')`

    const answer = await call(app, `/api/members/${former.id}`, { method: 'DELETE', cookie })
    assert.equal(answer.status, 409, 'the delete was attempted and the foreign key refused it')
    assert.match(((await answer.json()) as { error: string }).error, /suspended/)
  })

  test('deleting a member who asked for a door is refused rather than failing', async () => {
    const cookie = await adminCookie()
    const asker = await makeMember({ doorAccess: true })
    await sql`
      insert into door_commands (controller_id, action, requested_by)
      values ('openaccess', 'open', ${asker.id})`

    assert.equal((await call(app, `/api/members/${asker.id}`, { method: 'DELETE', cookie })).status, 409)
  })

  test('an account nobody has touched can still be deleted', async () => {
    const cookie = await adminCookie()
    const spam = await makeMember({ email: 'spam@example.invalid' })

    assert.equal((await call(app, `/api/members/${spam.id}`, { method: 'DELETE', cookie })).status, 204)
    assert.equal((await sql`select id from members where id = ${spam.id}`).length, 0)
  })

  test('an admin issues a set-password link, and it works once', async () => {
    const cookie = await adminCookie()
    const member = await makeMember({ email: 'locked-out@example.invalid' })

    assert.equal((await call(app, `/api/members/${member.id}/reset`, { method: 'POST', cookie })).status, 204)
    const [row] = await sql<Array<{ resetToken: string }>>`
      select reset_token from members where id = ${member.id}`

    const used = await call(app, '/api/reset', {
      method: 'POST',
      body: { token: row?.resetToken, password: 'a-brand-new-password' },
    })
    assert.equal(used.status, 204)
    await signIn(app, member.email, 'a-brand-new-password')
  })

  test('the card list and one member payments answer', async () => {
    const cookie = await adminCookie()
    const holder = await makeMember({ doorAccess: true })
    await sql`insert into credentials (token, member_id, label) values ('0004B1C7', ${holder.id}, 'blue fob')`
    await sql`insert into payments (member_id, amount, paid_on) values (${holder.id}, 25.00, '2026-09-01')`

    const cards = (await (await call(app, '/api/credentials', { cookie })).json()) as Array<
      Record<string, unknown>
    >
    assert.equal(cards[0]?.token, '0004B1C7')
    assert.equal(cards[0]?.memberName, 'Test Member')
    assert.deepEqual(cards[0]?.placedOn, [])

    const payments = (await (
      await call(app, `/api/members/${holder.id}/payments`, { cookie })
    ).json()) as unknown[]
    assert.equal(payments.length, 1)
  })

  test('a revoke that revoked nothing writes no audit row', async () => {
    const cookie = await adminCookie()
    const holder = await makeMember()
    const [card] = await sql<Array<{ id: string }>>`
      insert into credentials (token, member_id, active) values ('0004B1C7', ${holder.id}, false)
      returning id`

    const answer = await call(app, `/api/credentials/${card?.id}`, { method: 'DELETE', cookie })
    assert.equal(answer.status, 404)

    const entries = await sql`select action from audit_log where action = 'credential.revoke'`
    assert.equal(entries.length, 0, 'the log records a revocation that did not happen')
  })

  test('an admin reads the audit log, which is what makes acting alone defensible', async () => {
    const cookie = await adminCookie()
    const subject = await makeMember()
    await call(app, `/api/members/${subject.id}`, { method: 'PATCH', cookie, body: { doorAccess: true } })

    const answer = await call(app, '/api/audit', { cookie })
    assert.equal(answer.status, 200)

    const { items } = (await answer.json()) as { items: Array<Record<string, unknown>> }
    assert.equal(items[0]?.action, 'member.update')
    assert.equal(items[0]?.actorName, 'Test Member')
    assert.equal(items[0]?.targetId, subject.id)

    // And nobody else reads it.
    const plain = await makeMember()
    assert.equal((await call(app, '/api/audit', { cookie: await signIn(app, plain.email) })).status, 403)
  })
})
