import type {
  ErrorResponse,
  Member,
  MemberDirectoryEntry,
  MemberResponse,
  MembersResponse,
  NewMember,
  PatchMemberRequest,
} from '@hsl/schema'
import {
  certifications,
  memberLevelLabel,
  patchMemberRequest,
  paymentStatus,
  user,
  userCertifications,
  waivers,
} from '@hsl/schema'
import { asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireAdmin, requireOriented, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'
import { cardView, memberSelfView, mostRecentPaidOn, paymentView, waiverView } from '../views.ts'
import { cardsFor } from './cards.ts'
import { heldCertificationsFor } from './certifications.ts'
import { paymentsFor } from './payments.ts'

/**
 * The directory and the admin's view of one member.
 *
 * The directory shows an email address or a phone number only where that member
 * turned the field on. The legacy users table carried email_visible and
 * phone_visible and members used them, so the two flags are real preferences
 * rather than a new idea.
 */

export function memberRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()

  return routes
    .get('/api/members', requireOriented, async (c) => {
      const rows = await deps.db
        .select()
        .from(user)
        .where(eq(user.hidden, false))
        .orderBy(asc(user.name))
      const slugs = await certificationSlugsByMember(deps.db)

      const body: MembersResponse = {
        members: rows.map((member) => directoryEntry(member, slugs.get(member.id) ?? [])),
      }
      return c.json(body)
    })
    .get('/api/members/:id', requireAdmin, async (c) => {
      const member = await findMember(deps.db, c.req.param('id'))
      if (member === null) return notFound(c)

      return c.json(await memberResponseFor(deps.db, member))
    })
    .patch('/api/members/:id', requireAdmin, jsonBody(patchMemberRequest), async (c) => {
      const member = await findMember(deps.db, c.req.param('id'))
      if (member === null) return notFound(c)

      const request = c.req.valid('json')
      if (Object.keys(request).length === 0) {
        const body: ErrorResponse = { error: 'The request asked for no change.' }
        return c.json(body, 400)
      }

      const updated = await applyPatch(deps.db, member, request, signedIn(c).id)

      await recordAudit(deps.db, {
        actorId: signedIn(c).id,
        action: 'member.update',
        targetId: member.id,
        detail: { changed: request, previous: previousValues(member, request) },
      })

      return c.json(await memberResponseFor(deps.db, updated))
    })
}

function directoryEntry(member: Member, slugs: string[]): MemberDirectoryEntry {
  return {
    id: member.id,
    name: member.name,
    email: member.emailVisible ? member.email : null,
    phone: member.phoneVisible ? member.phone : null,
    memberLevelLabel: memberLevelLabel(member.memberLevel),
    certifications: slugs,
  }
}

async function memberResponseFor(db: Database, member: Member): Promise<MemberResponse> {
  const [cards, certifications, payments, signedWaivers] = await Promise.all([
    cardsFor(db, member.id),
    heldCertificationsFor(db, member.id),
    paymentsFor(db, member.id),
    db.select().from(waivers).where(eq(waivers.userId, member.id)),
  ])

  return {
    member: {
      ...memberSelfView(member),
      createdAt: member.createdAt.toISOString(),
      orientedById: member.orientedById,
      legacyId: member.legacyId,
    },
    paymentStatus: paymentStatus(member.memberLevel, mostRecentPaidOn(payments), new Date()),
    cards: cards.map(cardView),
    certifications,
    payments: payments.map(paymentView),
    waivers: signedWaivers.map(waiverView),
  }
}

/**
 * Orientation carries who ran it, which is what the member detail screen shows
 * beside the date. An admin recording an orientation is the person who ran it.
 */
async function applyPatch(
  db: Database,
  member: Member,
  request: PatchMemberRequest,
  actorId: string,
): Promise<Member> {
  const { orientation, ...rest } = request
  const values: Partial<NewMember> = { ...rest, updatedAt: new Date() }

  if (orientation !== undefined) {
    values.orientation = orientation === null ? null : new Date(orientation)
    values.orientedById = orientation === null ? null : actorId
  }

  const updated = await db.update(user).set(values).where(eq(user.id, member.id)).returning()

  const row = updated[0]
  if (row === undefined) throw new Error('The member row vanished between the read and the update.')
  return row
}

function previousValues(member: Member, request: PatchMemberRequest): Record<string, unknown> {
  const previous: Record<string, unknown> = {}

  for (const key of Object.keys(request)) {
    const value = member[key as keyof Member]
    previous[key] = value instanceof Date ? value.toISOString() : value
  }

  return previous
}

/** Every non-hidden member's certification slugs, in one query rather than one per member. */
async function certificationSlugsByMember(db: Database): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: userCertifications.userId, slug: certifications.slug })
    .from(userCertifications)
    .innerJoin(certifications, eq(certifications.id, userCertifications.certificationId))

  const held = new Map<string, string[]>()
  for (const row of rows) {
    const existing = held.get(row.userId)
    if (existing === undefined) held.set(row.userId, [row.slug])
    else existing.push(row.slug)
  }

  return held
}

async function findMember(db: Database, memberId: string): Promise<Member | null> {
  const rows = await db.select().from(user).where(eq(user.id, memberId)).limit(1)
  return rows[0] ?? null
}

function notFound(c: Context<AppEnv>) {
  const body: ErrorResponse = { error: 'That member does not exist. Nothing was changed.' }
  return c.json(body, 404)
}
