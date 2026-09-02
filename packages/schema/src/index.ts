/**
 * The public surface of @hsl/schema. Nothing outside this package reaches past
 * this file.
 */

import type { z } from 'zod'

import * as contracts from './contracts.ts'
import type * as tables from './tables.ts'

export {
  account,
  auditLog,
  cards,
  certifications,
  doorEvents,
  payments,
  session,
  user,
  userCertifications,
  verification,
  waivers,
} from './tables.ts'

export type Member = typeof tables.user.$inferSelect
export type NewMember = typeof tables.user.$inferInsert
export type Card = typeof tables.cards.$inferSelect
export type NewCard = typeof tables.cards.$inferInsert
export type Certification = typeof tables.certifications.$inferSelect
export type UserCertification = typeof tables.userCertifications.$inferSelect
export type Payment = typeof tables.payments.$inferSelect
export type NewPayment = typeof tables.payments.$inferInsert
export type Waiver = typeof tables.waivers.$inferSelect
export type AuditLogRow = typeof tables.auditLog.$inferSelect
export type NewAuditLogRow = typeof tables.auditLog.$inferInsert
export type DoorEventRow = typeof tables.doorEvents.$inferSelect
export type NewDoorEventRow = typeof tables.doorEvents.$inferInsert

export {
  auditEntry,
  cardTableEntry,
  cardTableViewResponse,
  doorEventEntry,
  doorEventsResponse,
  syncResponse,
  unknownCard,
  unknownCardsResponse,
  auditQuery,
  auditResponse,
  cardRecord,
  cardResponse,
  certificationRecord,
  certificationSlug,
  certificationsResponse,
  doorControlRequest,
  doorControlResponse,
  doorStatusResponse,
  errorResponse,
  grantCertificationRequest,
  heldCertification,
  memberCertificationsResponse,
  memberDirectoryEntry,
  memberLevelValue,
  memberResponse,
  memberSelf,
  membersResponse,
  meResponse,
  patchCardRequest,
  patchMemberRequest,
  patchMeRequest,
  paymentRecord,
  paymentResponse,
  paymentStatusValue,
  postCardRequest,
  postPaymentRequest,
  signupRequest,
  signupResponse,
  signupTier,
  spaceApiResponse,
  waiverRecord,
} from './contracts.ts'

export type MemberSelf = z.infer<typeof contracts.memberSelf>
export type CardRecord = z.infer<typeof contracts.cardRecord>
export type CertificationRecord = z.infer<typeof contracts.certificationRecord>
export type HeldCertification = z.infer<typeof contracts.heldCertification>
export type PaymentRecord = z.infer<typeof contracts.paymentRecord>
export type WaiverRecord = z.infer<typeof contracts.waiverRecord>
export type MemberDirectoryEntry = z.infer<typeof contracts.memberDirectoryEntry>
export type CardTableEntry = z.infer<typeof contracts.cardTableEntry>
export type CardTableViewResponse = z.infer<typeof contracts.cardTableViewResponse>
export type DoorEventEntry = z.infer<typeof contracts.doorEventEntry>
export type DoorEventsResponse = z.infer<typeof contracts.doorEventsResponse>
export type SyncResponse = z.infer<typeof contracts.syncResponse>
export type UnknownCard = z.infer<typeof contracts.unknownCard>
export type UnknownCardsResponse = z.infer<typeof contracts.unknownCardsResponse>
export type AuditEntry = z.infer<typeof contracts.auditEntry>

export type MeResponse = z.infer<typeof contracts.meResponse>
export type PatchMeRequest = z.infer<typeof contracts.patchMeRequest>
export type SignupRequest = z.infer<typeof contracts.signupRequest>
export type SignupResponse = z.infer<typeof contracts.signupResponse>
export type MembersResponse = z.infer<typeof contracts.membersResponse>
export type MemberResponse = z.infer<typeof contracts.memberResponse>
export type PatchMemberRequest = z.infer<typeof contracts.patchMemberRequest>
export type PostCardRequest = z.infer<typeof contracts.postCardRequest>
export type PatchCardRequest = z.infer<typeof contracts.patchCardRequest>
export type CardResponse = z.infer<typeof contracts.cardResponse>
export type CertificationsResponse = z.infer<typeof contracts.certificationsResponse>
export type GrantCertificationRequest = z.infer<typeof contracts.grantCertificationRequest>
export type MemberCertificationsResponse = z.infer<typeof contracts.memberCertificationsResponse>
export type PostPaymentRequest = z.infer<typeof contracts.postPaymentRequest>
export type PaymentResponse = z.infer<typeof contracts.paymentResponse>
export type AuditQuery = z.infer<typeof contracts.auditQuery>
export type AuditResponse = z.infer<typeof contracts.auditResponse>
export type DoorControlRequest = z.infer<typeof contracts.doorControlRequest>
export type DoorControlResponse = z.infer<typeof contracts.doorControlResponse>
export type DoorStatusResponse = z.infer<typeof contracts.doorStatusResponse>
export type SpaceApiResponse = z.infer<typeof contracts.spaceApiResponse>
export type ErrorResponse = z.infer<typeof contracts.errorResponse>

export {
  assignableCardSlot,
  cardNumber,
  cardPermissions,
  CARD_SLOT_COUNT,
  cardTableResponse,
  REFUSED_DOOR_COMMANDS,
  doorCommand,
  CARD_PRESENTED,
  cardPresentedDetail,
  cardReadOutcome,
  doorEventReport,
  doorLogEntry,
  doorName,
  doorReportRequest,
  doorReportResponse,
  doorStatus,
  LAST_USABLE_CARD_SLOT,
  storedCardSlot,
  syncCard,
} from './door.ts'

export type {
  Door,
  DoorCommand,
  DoorController,
  DoorLogEntry,
  DoorStatus,
  SyncCard,
} from './door.ts'

export { memberLevelLabel, paymentStatus, paymentStatuses } from './members.ts'
export type { PaymentStatus } from './members.ts'
