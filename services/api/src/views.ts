import type {
  AuditEntry,
  AuditLogRow,
  Card,
  CardRecord,
  HeldCertification,
  Member,
  MemberSelf,
  Payment,
  PaymentRecord,
  Waiver,
  WaiverRecord,
} from '@hsl/schema'
import { memberLevelLabel } from '@hsl/schema'

/**
 * Database rows turned into the response shapes in @hsl/schema. The API and the
 * apps agree about these because both sides read the same contracts, so a shape
 * that changes stops compiling in both places.
 */

export function memberSelfView(member: Member): MemberSelf {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    emailVerified: member.emailVerified,
    phone: member.phone,
    postalCode: member.postalCode,
    emergencyName: member.emergencyName,
    emergencyPhone: member.emergencyPhone,
    emergencyEmail: member.emergencyEmail,
    memberLevel: member.memberLevel,
    memberLevelLabel: memberLevelLabel(member.memberLevel),
    waiver: member.waiver?.toISOString() ?? null,
    orientation: member.orientation?.toISOString() ?? null,
    hidden: member.hidden,
    emailVisible: member.emailVisible,
    phoneVisible: member.phoneVisible,
    currentSkills: member.currentSkills,
    desiredSkills: member.desiredSkills,
    paymentMethod: member.paymentMethod,
    payee: member.payee,
    admin: member.admin,
    instructor: member.instructor,
    accountant: member.accountant,
    cardAccess: member.cardAccess,
  }
}

export function cardView(card: Card): CardRecord {
  return {
    slot: card.id,
    cardNumber: card.cardNumber,
    userId: card.userId,
    label: card.label,
    permissions: card.permissions,
    active: card.active,
  }
}

export function paymentView(payment: Payment): PaymentRecord {
  return {
    id: payment.id,
    userId: payment.userId,
    amountCents: payment.amountCents,
    paidOn: payment.paidOn,
    note: payment.note,
    recordedById: payment.recordedById,
    createdAt: payment.createdAt.toISOString(),
  }
}

export function waiverView(waiver: Waiver): WaiverRecord {
  return {
    id: waiver.id,
    signedAt: waiver.signedAt.toISOString(),
    documentRef: waiver.documentRef,
    cosigner: waiver.cosigner,
    recordedById: waiver.recordedById,
  }
}

export interface HeldCertificationRow {
  slug: string
  name: string
  grantedAt: Date
  grantedById: string | null
  grantedByName: string | null
}

export function heldCertificationView(row: HeldCertificationRow): HeldCertification {
  return {
    slug: row.slug,
    name: row.name,
    grantedAt: row.grantedAt.toISOString(),
    grantedById: row.grantedById,
    grantedByName: row.grantedByName,
  }
}

export function auditEntryView(row: AuditLogRow, actorName: string | null): AuditEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actorId: row.actorId,
    actorName,
    action: row.action,
    targetId: row.targetId,
    detail: row.detail ?? null,
  }
}

/**
 * The newest paid_on a member has, as a Date. paid_on is a date column read as
 * a string, and a bare date parses as UTC midnight, which is what the 60 day
 * dues window in @hsl/schema expects.
 */
export function mostRecentPaidOn(payments: Payment[]): Date | null {
  let newest: string | null = null

  for (const payment of payments) {
    if (newest === null || payment.paidOn > newest) newest = payment.paidOn
  }

  return newest === null ? null : new Date(newest)
}
