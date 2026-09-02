import type {
  CertificationsResponse,
  ErrorResponse,
  HeldCertification,
  MemberCertificationsResponse,
} from '@hsl/schema'
import { certifications, grantCertificationRequest, user, userCertifications } from '@hsl/schema'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Context } from 'hono'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireInstructor, requireMember, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'
import { heldCertificationView } from '../views.ts'

/**
 * The tool list, and who holds what. Granting and revoking are the instructor's,
 * and an admin passes the same check.
 */

const grantedBy = alias(user, 'granted_by')

/** What one member holds. Exported because /api/me and the member detail both show it. */
export async function heldCertificationsFor(
  db: Database,
  memberId: string,
): Promise<HeldCertification[]> {
  const rows = await db
    .select({
      slug: certifications.slug,
      name: certifications.name,
      grantedAt: userCertifications.grantedAt,
      grantedById: userCertifications.grantedById,
      grantedByName: grantedBy.name,
    })
    .from(userCertifications)
    .innerJoin(certifications, eq(certifications.id, userCertifications.certificationId))
    // Left, because an imported row may name a grantor who is no longer a member.
    .leftJoin(grantedBy, eq(grantedBy.id, userCertifications.grantedById))
    .where(eq(userCertifications.userId, memberId))

  return rows.map(heldCertificationView)
}

export function certificationRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .get('/api/certifications', requireMember, async (c) => {
      const rows = await deps.db.select().from(certifications).orderBy(certifications.name)
      const body: CertificationsResponse = { certifications: rows }
      return c.json(body)
    })
    .post(
      '/api/members/:id/certifications',
      requireInstructor,
      jsonBody(grantCertificationRequest),
      async (c) => {
        const memberId = c.req.param('id')
        const { slug } = c.req.valid('json')

        const certification = await findCertification(deps.db, slug)
        if (certification === null) return notFound(c, `There is no certification called ${slug}.`)
        if (!(await memberExists(deps.db, memberId))) {
          return notFound(c, 'That member does not exist.')
        }

        const held = await heldCertificationsFor(deps.db, memberId)
        if (held.some((entry) => entry.slug === slug)) {
          const body: ErrorResponse = {
            error: `That member already holds ${slug}. Nothing was changed.`,
          }
          return c.json(body, 409)
        }

        await deps.db.insert(userCertifications).values({
          userId: memberId,
          certificationId: certification.id,
          grantedById: signedIn(c).id,
        })
        await recordAudit(deps.db, {
          actorId: signedIn(c).id,
          action: 'certification.grant',
          targetId: memberId,
          detail: { slug },
        })

        const body: MemberCertificationsResponse = {
          certifications: await heldCertificationsFor(deps.db, memberId),
        }
        return c.json(body, 201)
      },
    )
    .delete('/api/members/:id/certifications/:slug', requireInstructor, async (c) => {
      const memberId = c.req.param('id')
      const slug = c.req.param('slug')

      const certification = await findCertification(deps.db, slug)
      if (certification === null) return notFound(c, `There is no certification called ${slug}.`)

      const removed = await deps.db
        .delete(userCertifications)
        .where(
          and(
            eq(userCertifications.userId, memberId),
            eq(userCertifications.certificationId, certification.id),
          ),
        )
        .returning({ id: userCertifications.id })

      if (removed.length === 0) {
        return notFound(c, `That member does not hold ${slug}. Nothing was changed.`)
      }

      await recordAudit(deps.db, {
        actorId: signedIn(c).id,
        action: 'certification.revoke',
        targetId: memberId,
        detail: { slug },
      })

      const body: MemberCertificationsResponse = {
        certifications: await heldCertificationsFor(deps.db, memberId),
      }
      return c.json(body)
    })
}

async function findCertification(db: Database, slug: string) {
  const rows = await db.select().from(certifications).where(eq(certifications.slug, slug)).limit(1)
  return rows[0] ?? null
}

async function memberExists(db: Database, memberId: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, memberId)).limit(1)
  return rows.length > 0
}

function notFound(c: Context<AppEnv>, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, 404)
}
