import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Table and column comments are not expressible in drizzle-orm 0.45.2, so every
 * COMMENT ON statement lives in migrations/0001_table_comments.sql instead.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/**
 * The member row and the better-auth user row are the same row. The first block
 * of columns is what better-auth 1.7.2 builds in @better-auth/core/db/get-tables;
 * the rest is the lab's own record of the person.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),

  phone: text('phone'),
  postalCode: text('postal_code'),
  emergencyName: text('emergency_name'),
  emergencyPhone: text('emergency_phone'),
  emergencyEmail: text('emergency_email'),
  // Nullable because 27 of the 1,061 legacy rows have no member_level.
  memberLevel: integer('member_level'),
  waiver: timestamp('waiver', { withTimezone: true }),
  orientation: timestamp('orientation', { withTimezone: true }),
  orientedById: text('oriented_by_id').references((): AnyPgColumn => user.id),
  hidden: boolean('hidden').notNull().default(false),
  emailVisible: boolean('email_visible').notNull().default(false),
  phoneVisible: boolean('phone_visible').notNull().default(false),
  currentSkills: text('current_skills'),
  desiredSkills: text('desired_skills'),
  paymentMethod: text('payment_method'),
  payee: text('payee'),
  admin: boolean('admin').notNull().default(false),
  instructor: boolean('instructor').notNull().default(false),
  accountant: boolean('accountant').notNull().default(false),
  cardAccess: boolean('card_access').notNull().default(false),
  legacyId: integer('legacy_id').unique(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

/**
 * The sign-in handler filters on issuer, accountId and providerId together, so
 * the import writes all three. See decisions/0004-keep-bcrypt.md.
 */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    uniqueIndex('account_issuer_account_id_idx').on(t.issuer, t.accountId),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

/**
 * id is the card's slot in the controller's EEPROM table, not a surrogate key.
 * Slot n lives at EEPROM byte 24 + n * 5. It is assigned once and never
 * renumbered, because renumbering hands a member someone else's door permission.
 * There is deliberately no CHECK on the range: production holds one card at slot
 * 200 and a constraint would reject it at import.
 */
export const cards = pgTable(
  'cards',
  {
    id: integer('id').primaryKey(),
    cardNumber: text('card_number').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    label: text('label'),
    // 63 of the 64 legacy cards carry 1 and one carries 255.
    permissions: integer('permissions').notNull().default(1),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('cards_user_id_idx').on(t.userId)],
)

export const certifications = pgTable('certifications', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
})

export const userCertifications = pgTable(
  'user_certifications',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    certificationId: integer('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'restrict' }),
    grantedById: text('granted_by_id').references(() => user.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_certifications_user_id_idx').on(t.userId)],
)

export const payments = pgTable(
  'payments',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    note: text('note'),
    recordedById: text('recorded_by_id').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('payments_user_id_paid_on_idx').on(t.userId, t.paidOn)],
)

export const waivers = pgTable(
  'waivers',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    documentRef: text('document_ref').notNull(),
    cosigner: text('cosigner'),
    recordedById: text('recorded_by_id').references(() => user.id),
  },
  (t) => [index('waivers_user_id_idx').on(t.userId)],
)

/**
 * Append-only. Nothing updates or deletes a row here, and a trigger in
 * migrations/0001_table_comments.sql refuses both.
 * See decisions/0008-single-admin-plus-audit-log.md.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id').references(() => user.id),
    action: text('action').notNull(),
    targetId: text('target_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
)

export const doorEvents = pgTable(
  'door_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    actorId: text('actor_id').references(() => user.id),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('door_events_at_idx').on(t.at)],
)
