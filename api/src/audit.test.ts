import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'

import { change } from './audit.ts'
import { sql } from './db.ts'
import { app } from './index.ts'
import { call, makeMember, reset, signIn, stop } from './test-support.ts'

describe('the record', () => {
  beforeEach(reset)
  after(stop)

  test('a write and its audit row land together', async () => {
    const admin = await makeMember({ roles: ['admin'] })
    const subject = await makeMember()
    const cookie = await signIn(app, admin.email)

    await call(app, `/api/members/${subject.id}`, {
      method: 'PATCH',
      cookie,
      body: { doorAccess: true },
    })

    const [entry] = await sql<Array<{ action: string; actorId: string; targetId: string; detail: unknown }>>`
      select action, actor_id, target_id, detail from audit_log order by id desc limit 1`

    assert.equal(entry?.action, 'member.update')
    assert.equal(entry?.actorId, admin.id)
    assert.equal(entry?.targetId, subject.id)
    assert.deepEqual(entry?.detail, { fields: ['doorAccess'] })
  })

  test('a write that fails takes its audit row down with it', async () => {
    const actor = await makeMember()

    await assert.rejects(
      change({ actor: actor.id, action: 'credential.issue', target: 'nobody' }, (tx) =>
        tx`insert into credentials (token, member_id)
           values ('DEADBEEF', '00000000-0000-4000-8000-000000000000')`,
      ),
    )

    assert.equal((await sql`select id from audit_log`).length, 0)
  })

  test('audit_log refuses update and delete, and names itself', async () => {
    const actor = await makeMember()
    await change({ actor: actor.id, action: 'member.create', target: actor.id }, async () => undefined)

    await assert.rejects(
      () => sql`update audit_log set action = 'nothing happened'`,
      (error: Error) => error.message.includes('audit_log is append only'),
    )
    await assert.rejects(
      () => sql`delete from audit_log`,
      (error: Error) => error.message.includes('audit_log is append only'),
    )
    assert.equal((await sql`select id from audit_log`).length, 1)
  })

  test('door_events refuses update and delete, and names itself rather than audit_log', async () => {
    await sql`insert into door_events (controller_id, kind) values ('openaccess', 'entry')`

    await assert.rejects(
      () => sql`delete from door_events`,
      (error: Error) => error.message.includes('door_events is append only'),
    )
  })

  test('every privileged route leaves exactly one row behind', async () => {
    const admin = await makeMember({ roles: ['admin', 'accountant', 'instructor'] })
    const subject = await makeMember()
    const cookie = await signIn(app, admin.email)
    await sql`insert into certifications (slug, name) values ('laser', 'Laser Cutter')`

    const [card] = [
      await call(app, '/api/credentials', {
        method: 'POST',
        cookie,
        body: { token: '0004B1C7', memberId: subject.id },
      }),
    ]
    const issued = (await (card as Response).json()) as { id: string }

    await call(app, `/api/members/${subject.id}/certifications`, {
      method: 'POST',
      cookie,
      body: { slug: 'laser' },
    })
    await call(app, '/api/payments', {
      method: 'POST',
      cookie,
      body: { memberId: subject.id, amount: '25.00', paidOn: '2026-09-01' },
    })
    await call(app, `/api/credentials/${issued.id}`, { method: 'DELETE', cookie })

    const actions = (await sql<Array<{ action: string }>>`select action from audit_log order by id`).map(
      (row) => row.action,
    )
    assert.deepEqual(actions, ['credential.issue', 'cert.grant', 'payment.record', 'credential.revoke'])
  })
})
