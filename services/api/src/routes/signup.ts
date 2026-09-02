import type { ErrorResponse, SignupRequest, SignupResponse } from '@hsl/schema'
import { signupRequest, user, waivers } from '@hsl/schema'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { jsonBody } from '../middleware/validate.ts'

/**
 * Joining. The account is created through better-auth so the password is hashed
 * the one way this system hashes passwords, then the member's own fields and
 * the waiver are written beside it.
 *
 * No audit row: signing up is not a privileged change. The waiver row is the
 * durable record that the release was accepted.
 */

/**
 * Which waiver text was accepted. The signup app shows one release; a new
 * release gets a new reference so an old row still says what was signed.
 */
const ONLINE_WAIVER_DOCUMENT_REF = 'signup-online-v1'

export function signupRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .post('/api/signup', jsonBody(signupRequest), async (c) => {
      const request = c.req.valid('json')

      let created
      try {
        created = await deps.auth.api.signUpEmail({
          body: { name: request.name, email: request.email, password: request.password },
          returnHeaders: true,
        })
      } catch (error) {
        if (error instanceof APIError) {
          const body: ErrorResponse = {
            error:
              'An account already exists for that email address, or the password was refused. Nothing was created. Sign in, or reset the password.',
          }
          return c.json(body, 409)
        }
        throw error
      }

      await recordMemberAndWaiver(deps.db, created.response.user.id, request)

      // better-auth signs the new member in, so its cookies have to reach them.
      for (const cookie of created.headers.getSetCookie()) {
        c.header('set-cookie', cookie, { append: true })
      }

      const body: SignupResponse = {
        id: created.response.user.id,
        email: created.response.user.email,
      }
      return c.json(body, 201)
    })
}

/**
 * The member's own fields and their waiver, in one transaction, so a member
 * never ends up recorded without the release they accepted.
 */
async function recordMemberAndWaiver(
  db: Database,
  memberId: string,
  request: SignupRequest,
): Promise<void> {
  const signedAt = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        phone: request.phone ?? null,
        postalCode: request.postalCode ?? null,
        emergencyName: request.emergencyName ?? null,
        emergencyPhone: request.emergencyPhone ?? null,
        emergencyEmail: request.emergencyEmail ?? null,
        memberLevel: request.memberLevel,
        waiver: signedAt,
        updatedAt: signedAt,
      })
      .where(eq(user.id, memberId))

    await tx.insert(waivers).values({
      userId: memberId,
      signedAt,
      documentRef: ONLINE_WAIVER_DOCUMENT_REF,
      cosigner: request.cosigner ?? null,
    })
  })
}
