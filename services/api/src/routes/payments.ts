import type { ErrorResponse, Payment, PaymentResponse } from '@hsl/schema'
import { payments, postPaymentRequest, user } from '@hsl/schema'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireAccountant, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'
import { paymentView } from '../views.ts'

/**
 * Recorded dues. Money arrives offline through the rails the lab already has,
 * and an accountant enters what arrived. There is no payment integration here.
 */

export async function paymentsFor(db: Database, memberId: string): Promise<Payment[]> {
  return db
    .select()
    .from(payments)
    .where(eq(payments.userId, memberId))
    .orderBy(desc(payments.paidOn))
}

export function paymentRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .post('/api/payments', requireAccountant, jsonBody(postPaymentRequest), async (c) => {
      const request = c.req.valid('json')

      const member = await deps.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, request.userId))
        .limit(1)
      if (member.length === 0) {
        const body: ErrorResponse = { error: 'That member does not exist. Nothing was recorded.' }
        return c.json(body, 404)
      }

      const inserted = await deps.db
        .insert(payments)
        .values({
          userId: request.userId,
          amountCents: request.amountCents,
          paidOn: request.paidOn,
          note: request.note ?? null,
          recordedById: signedIn(c).id,
        })
        .returning()

      const payment = inserted[0]
      if (payment === undefined) throw new Error('The payment insert returned no row.')

      await recordAudit(deps.db, {
        actorId: signedIn(c).id,
        action: 'payment.record',
        targetId: request.userId,
        detail: { amountCents: payment.amountCents, paidOn: payment.paidOn },
      })

      const body: PaymentResponse = { payment: paymentView(payment) }
      return c.json(body, 201)
    })
}
