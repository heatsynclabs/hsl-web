import type { ErrorResponse, Member, MeResponse } from '@hsl/schema'
import { patchMeRequest, paymentStatus, user } from '@hsl/schema'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireMember, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'
import { cardView, memberSelfView, mostRecentPaidOn, paymentView } from '../views.ts'
import { cardsFor } from './cards.ts'
import { heldCertificationsFor } from './certifications.ts'
import { paymentsFor } from './payments.ts'

/**
 * The member's own record. Everything here is about the person making the
 * request and nobody else.
 *
 * PATCH accepts the contact fields and the three visibility flags, and nothing
 * else. The Rails attr_accessible list let a member set accountant,
 * member_level, waiver and orientation on themself; those four are not in
 * patchMeRequest, the schema is strict, so an attempt to send one is refused
 * with a 400 rather than quietly dropped.
 *
 * hidden was on that Rails list too and is deliberately kept here. It is the
 * member asking to be left out of the directory, which is their own preference
 * rather than a privilege, and it grants nothing. The other four are privileges.
 */

export async function meResponseFor(db: Database, member: Member): Promise<MeResponse> {
  const [cards, certifications, payments] = await Promise.all([
    cardsFor(db, member.id),
    heldCertificationsFor(db, member.id),
    paymentsFor(db, member.id),
  ])

  return {
    member: memberSelfView(member),
    paymentStatus: paymentStatus(member.memberLevel, mostRecentPaidOn(payments), new Date()),
    cards: cards.map(cardView),
    certifications,
    payments: payments.map(paymentView),
  }
}

export function meRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .get('/api/me', requireMember, async (c) => {
      return c.json(await meResponseFor(deps.db, signedIn(c)))
    })
    .patch('/api/me', requireMember, jsonBody(patchMeRequest), async (c) => {
      const request = c.req.valid('json')

      if (Object.keys(request).length === 0) {
        const body: ErrorResponse = { error: 'The request asked for no change.' }
        return c.json(body, 400)
      }

      // Safe to spread because every key patchMeRequest allows is a column of the
      // same name and type, and the schema refuses any key it does not allow.
      const updated = await deps.db
        .update(user)
        .set({ ...request, updatedAt: new Date() })
        .where(eq(user.id, signedIn(c).id))
        .returning()

      const member = updated[0]
      if (member === undefined) throw new Error('The signed-in member has no row to update.')

      return c.json(await meResponseFor(deps.db, member))
    })
}
