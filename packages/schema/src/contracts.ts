import { z } from 'zod'

import {
  cardNumber,
  cardPermissions,
  doorCommand,
  doorStatus,
  storedCardSlot,
} from './door.ts'
import { paymentStatuses } from './members.ts'

/**
 * One request schema and one response schema per route in docs/architecture.md.
 * The API validates with these and the client types from them, so a route that
 * changes shape stops compiling in both places.
 *
 * Request bodies are strict: an unknown key is refused rather than ignored, so
 * nobody can smuggle admin: true into a profile edit the way the Rails
 * attr_accessible list allowed.
 *
 * Timestamps cross the wire as ISO strings because that is what JSON.stringify
 * makes of a Date.
 */

export const memberLevelValue = z.int().min(0).max(999)
export const certificationSlug = z.string().min(1).max(64)
export const paymentStatusValue = z.enum(paymentStatuses)

const timestampValue = z.iso.datetime()
const shortText = z.string().max(200)
const phoneText = z.string().max(40)
const longText = z.string().max(2000)

export const errorResponse = z.object({
  error: z.string(),
})

/** The member's own row. Every field here is one the member may see about themself. */
export const memberSelf = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  phone: z.string().nullable(),
  postalCode: z.string().nullable(),
  emergencyName: z.string().nullable(),
  emergencyPhone: z.string().nullable(),
  emergencyEmail: z.string().nullable(),
  memberLevel: memberLevelValue.nullable(),
  memberLevelLabel: z.string().nullable(),
  waiver: timestampValue.nullable(),
  orientation: timestampValue.nullable(),
  hidden: z.boolean(),
  emailVisible: z.boolean(),
  phoneVisible: z.boolean(),
  currentSkills: z.string().nullable(),
  desiredSkills: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  payee: z.string().nullable(),
  admin: z.boolean(),
  instructor: z.boolean(),
  accountant: z.boolean(),
  cardAccess: z.boolean(),
})

/**
 * slot is the cards.id column. It accepts 200 so the one legacy card sitting
 * there still renders on the admin screen, even though no new card is put there.
 */
export const cardRecord = z.object({
  slot: storedCardSlot,
  cardNumber,
  userId: z.string(),
  label: z.string().nullable(),
  permissions: cardPermissions,
  active: z.boolean(),
})

export const certificationRecord = z.object({
  id: z.int(),
  slug: certificationSlug,
  name: z.string(),
  description: z.string().nullable(),
})

export const heldCertification = z.object({
  slug: certificationSlug,
  name: z.string(),
  grantedAt: timestampValue,
  grantedById: z.string().nullable(),
  grantedByName: z.string().nullable(),
})

export const paymentRecord = z.object({
  id: z.int(),
  userId: z.string(),
  amountCents: z.int(),
  paidOn: z.iso.date(),
  note: z.string().nullable(),
  recordedById: z.string().nullable(),
  createdAt: timestampValue,
})

export const waiverRecord = z.object({
  id: z.int(),
  signedAt: timestampValue,
  documentRef: z.string(),
  cosigner: z.string().nullable(),
  recordedById: z.string().nullable(),
})

// GET /api/me
export const meResponse = z.object({
  member: memberSelf,
  paymentStatus: paymentStatusValue,
  cards: z.array(cardRecord),
  certifications: z.array(heldCertification),
  payments: z.array(paymentRecord),
})

// PATCH /api/me
export const patchMeRequest = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  phone: phoneText.nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  emergencyName: shortText.nullable().optional(),
  emergencyPhone: phoneText.nullable().optional(),
  emergencyEmail: z.email().nullable().optional(),
  currentSkills: longText.nullable().optional(),
  desiredSkills: longText.nullable().optional(),
  emailVisible: z.boolean().optional(),
  phoneVisible: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

/**
 * The dues tiers a person can pick at signup. Every level present in production
 * except 1 (Unable), which an admin sets and nobody chooses for themself.
 */
export const signupTier = z.union([
  z.literal(0),
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(100),
])

// POST /api/signup. The minimum password length matches better-auth's default of 8.
export const signupRequest = z.strictObject({
  name: z.string().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
  phone: phoneText.optional(),
  postalCode: z.string().max(20).optional(),
  emergencyName: shortText.optional(),
  emergencyPhone: phoneText.optional(),
  emergencyEmail: z.email().optional(),
  memberLevel: signupTier,
  waiverAccepted: z.literal(true),
  cosigner: shortText.optional(),
})

export const signupResponse = z.object({
  id: z.string(),
  email: z.email(),
})

/** One row of the directory. email and phone are null unless the member shows them. */
export const memberDirectoryEntry = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  memberLevelLabel: z.string().nullable(),
  certifications: z.array(certificationSlug),
})

// GET /api/members
export const membersResponse = z.object({
  members: z.array(memberDirectoryEntry),
})

// GET /api/members/:id and PATCH /api/members/:id
export const memberResponse = z.object({
  member: memberSelf.extend({
    createdAt: timestampValue,
    orientedById: z.string().nullable(),
    legacyId: z.int().nullable(),
  }),
  paymentStatus: paymentStatusValue,
  cards: z.array(cardRecord),
  certifications: z.array(heldCertification),
  payments: z.array(paymentRecord),
  waivers: z.array(waiverRecord),
})

export const patchMemberRequest = z.strictObject({
  memberLevel: memberLevelValue.nullable().optional(),
  orientation: timestampValue.nullable().optional(),
  cardAccess: z.boolean().optional(),
  admin: z.boolean().optional(),
  instructor: z.boolean().optional(),
  accountant: z.boolean().optional(),
})

// POST /api/cards. The server picks the lowest free slot, so no slot is sent.
export const postCardRequest = z.strictObject({
  userId: z.string().min(1),
  cardNumber,
  label: z.string().max(120).optional(),
  permissions: cardPermissions.optional(),
})

// PATCH /api/cards/:id, where :id is the slot.
export const patchCardRequest = z.strictObject({
  userId: z.string().min(1).optional(),
  label: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
})

export const cardResponse = z.object({
  card: cardRecord,
})

// GET /api/certifications
export const certificationsResponse = z.object({
  certifications: z.array(certificationRecord),
})

// POST and DELETE under /api/members/:id/certifications
export const grantCertificationRequest = z.strictObject({
  slug: certificationSlug,
})

export const memberCertificationsResponse = z.object({
  certifications: z.array(heldCertification),
})

// POST /api/payments
export const postPaymentRequest = z.strictObject({
  userId: z.string().min(1),
  amountCents: z.int().min(1),
  paidOn: z.iso.date(),
  note: z.string().max(500).optional(),
})

export const paymentResponse = z.object({
  payment: paymentRecord,
})

export const auditEntry = z.object({
  id: z.int(),
  at: timestampValue,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
})

// GET /api/audit, newest first. before is the id of the oldest entry already held.
export const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
})

export const auditResponse = z.object({
  entries: z.array(auditEntry),
  nextBefore: z.int().nullable(),
})

/**
 * POST /api/door/control. unlock-rear is in the vocabulary so the route can
 * refuse it by name rather than call it unknown; the refusal is the API's, per
 * the lab decision of 2018-02-22.
 */
export const doorControlRequest = z.strictObject({
  command: doorCommand,
})

export const doorControlResponse = z.object({
  command: doorCommand,
  queuedAt: timestampValue,
})

// GET /api/door/status. Null until the door service has posted once.
export const doorStatusResponse = z.object({
  status: doorStatus.nullable(),
  reportedAt: timestampValue.nullable(),
  stale: z.boolean(),
})

/**
 * GET /space_api.json. The body of the document is a SpaceAPI 0.12 template the
 * lab edits, so only the two keys the server adds are pinned.
 */
export const spaceApiResponse = z.looseObject({
  open: z.boolean(),
  status: z.string(),
})
