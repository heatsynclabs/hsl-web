import { user } from '@hsl/schema'
import { eq } from 'drizzle-orm'

import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'

/**
 * Makes an existing member an admin, from the host.
 *
 * A fresh install has nobody who can reach the admin app, and every route that
 * could grant admin already requires one. That is the right way round, but it
 * leaves a new lab unable to start, so there has to be one door in from outside
 * the application, and it should be the one that needs a shell on the machine
 * running the database.
 *
 *   make admin EMAIL=someone@example.org
 *
 * It refuses to create a member. Somebody has to sign up through the signup app
 * first, so the account has a password its owner chose and nobody else knows.
 *
 * The change is written to the audit log with no actor, because there is no
 * member behind it. A row with a null actor means somebody with a shell did
 * this, which is exactly what happened and is worth being able to see.
 */

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase()

  if (email === undefined || email === '') {
    console.error('Usage: node dist/make-admin.js <email>')
    console.error('The member has to exist already. Sign them up first.')
    process.exitCode = 1
    return
  }

  const config = loadConfig(process.env)
  const { db, pool } = createDatabase(config)

  try {
    const [member] = await db.select().from(user).where(eq(user.email, email)).limit(1)

    if (member === undefined) {
      console.error(
        `No member has the address ${email}, so nothing was changed. Sign up at the signup app ` +
          'first, then run this again.',
      )
      process.exitCode = 1
      return
    }

    if (member.admin) {
      console.log(`${email} is already an admin. Nothing was changed.`)
      return
    }

    await db.update(user).set({ admin: true }).where(eq(user.id, member.id))
    await recordFromTheHost(db, member.id, email)

    console.log(`${email} is now an admin.`)
  } finally {
    await pool.end()
  }
}

async function recordFromTheHost(
  db: ReturnType<typeof createDatabase>['db'],
  memberId: string,
  email: string,
): Promise<void> {
  const { auditLog } = await import('@hsl/schema')

  await db.insert(auditLog).values({
    actorId: null,
    action: 'member.admin.on',
    targetId: memberId,
    detail: { email, by: 'make-admin on the host' },
  })
}

await main()
