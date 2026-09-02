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

/** Either the member's certifications after the change, or how it was refused. */
type CertificationOutcome =
  | { certifications: MemberCertificationsResponse }
  | { status: 404 | 409; reason: string }

/** Records that a member has been trained on one tool. */
async function grantCertification(
  deps: AppDeps,
  actorId: string,
  memberId: string,
  slug: string,
): Promise<CertificationOutcome> {
  const certification = await findCertification(deps.db, slug)
  if (certification === null) {
    return { status: 404, reason: `There is no certification called ${slug}.` }
  }
  if (!(await memberExists(deps.db, memberId))) {
    return { status: 404, reason: 'That member does not exist.' }
  }

  const held = await heldCertificationsFor(deps.db, memberId)
  if (held.some((entry) => entry.slug === slug)) {
    return { status: 409, reason: `That member already holds ${slug}. Nothing was changed.` }
  }

  await deps.db.insert(userCertifications).values({
    userId: memberId,
    certificationId: certification.id,
    grantedById: actorId,
  })
  await recordAudit(deps.db, {
    actorId,
    action: 'certification.grant',
    targetId: memberId,
    detail: { slug },
  })

  return { certifications: { certifications: await heldCertificationsFor(deps.db, memberId) } }
}

/** Takes a certification back. The grant stays in the audit log. */
async function revokeCertification(
  deps: AppDeps,
  actorId: string,
  memberId: string,
  slug: string,
): Promise<CertificationOutcome> {
  const certification = await findCertification(deps.db, slug)
  if (certification === null) {
    return { status: 404, reason: `There is no certification called ${slug}.` }
  }

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
    return { status: 404, reason: `That member does not hold ${slug}. Nothing was changed.` }
  }

  await recordAudit(deps.db, {
    actorId,
    action: 'certification.revoke',
    targetId: memberId,
    detail: { slug },
  })

  return { certifications: { certifications: await heldCertificationsFor(deps.db, memberId) } }
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
        const outcome = await grantCertification(
          deps,
          signedIn(c).id,
          c.req.param('id'),
          c.req.valid('json').slug,
        )
        if ('status' in outcome) return refuse(c, outcome.status, outcome.reason)
        return c.json(outcome.certifications, 201)
      },
    )
    .delete('/api/members/:id/certifications/:slug', requireInstructor, async (c) => {
      const outcome = await revokeCertification(
        deps,
        signedIn(c).id,
        c.req.param('id'),
        c.req.param('slug'),
      )
      if ('status' in outcome) return refuse(c, outcome.status, outcome.reason)
      return c.json(outcome.certifications)
    })
}

function refuse(c: Context<AppEnv>, status: 404 | 409, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, status)
}

async function findCertification(db: Database, slug: string) {
  const rows = await db.select().from(certifications).where(eq(certifications.slug, slug)).limit(1)
  return rows[0] ?? null
}

async function memberExists(db: Database, memberId: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, memberId)).limit(1)
  return rows.length > 0
}

