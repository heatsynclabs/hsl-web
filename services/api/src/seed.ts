import {
  account,
  auditLog,
  cards,
  certifications,
  doorEvents,
  payments,
  user,
  userCertifications,
} from '@hsl/schema'
import bcrypt from 'bcryptjs'

import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'

/**
 * Invented members, so the stack is worth looking at without a copy of the
 * lab's data. Nothing here is real: every name, address and card number is made
 * up, and the domain is example.test, which is reserved and cannot resolve.
 *
 * Everybody's password is the same and it is printed at the end. This is only
 * ever run against a local database, and it refuses to run against one that
 * already holds members.
 */

const PASSWORD = 'heatsync'

/** The ten tools the lab certifies on, which are the real slugs. */
const TOOLS = [
  ['laser', 'Laser Cutter'],
  ['cncmill', 'Mill (CNC)'],
  ['bigmill', 'Mill (Big)'],
  ['minimill', 'Mill (Mini)'],
  ['minilathe', 'Lathe (mini)'],
  ['biglathe', 'Lathe (Big)'],
  ['migwelder', 'Welder (MIG)'],
  ['tigwelder', 'Welder (TIG)'],
  ['tablesaw', 'Table Saw'],
  ['plasmacutter', 'Plasma Cutter'],
] as const

interface SeedMember {
  id: string
  name: string
  memberLevel: number
  admin?: boolean
  instructor?: boolean
  accountant?: boolean
  oriented?: boolean
  cardSlot?: number
  certifications?: string[]
}

/** A spread of the states the screens have to render, not a realistic roster. */
const MEMBERS: SeedMember[] = [
  {
    id: 'seed-sam',
    name: 'Sam Rivera',
    memberLevel: 50,
    oriented: true,
    cardSlot: 41,
    certifications: ['laser', 'tablesaw'],
  },
  {
    id: 'seed-dana',
    name: 'Dana Kim',
    memberLevel: 100,
    admin: true,
    oriented: true,
    cardSlot: 9,
    certifications: ['laser', 'bigmill', 'migwelder'],
  },
  {
    id: 'seed-jules',
    name: 'Jules Okafor',
    memberLevel: 50,
    instructor: true,
    oriented: true,
    cardSlot: 17,
    certifications: ['laser', 'tigwelder', 'plasmacutter'],
  },
  {
    id: 'seed-ari',
    name: 'Ari Beaulieu',
    memberLevel: 100,
    accountant: true,
    oriented: true,
    cardSlot: 3,
  },
  { id: 'seed-tam', name: 'Tam Nguyen', memberLevel: 25, oriented: true },
  { id: 'seed-mo', name: 'Mo Volkov', memberLevel: 25 },
  { id: 'seed-kit', name: 'Kit Ortiz', memberLevel: 10, oriented: true, cardSlot: 22 },
  { id: 'seed-robin', name: 'Robin Ashford', memberLevel: 0 },
]

function emailFor(name: string): string {
  return `${name.split(' ')[0]?.toLowerCase()}@example.test`
}

type Db = ReturnType<typeof createDatabase>['db']

/** The tool list, returned as a lookup from slug to id. */
async function insertTools(db: Db): Promise<Map<string, number>> {
  const tools = await db
    .insert(certifications)
    .values(TOOLS.map(([slug, name]) => ({ slug, name, description: null })))
    .returning()

  return new Map(tools.map((tool) => [tool.slug, tool.id]))
}

/**
 * Every member row and its credential. This runs before anything else, because
 * cards, certifications and payments all point at a member, and a certification
 * also names the instructor who granted it.
 */
async function insertMembers(db: Db, hash: string): Promise<void> {
  const now = new Date()

  for (const member of MEMBERS) {
    await db.insert(user).values({
      id: member.id,
      name: member.name,
      email: emailFor(member.name),
      emailVerified: true,
      updatedAt: now,
      memberLevel: member.memberLevel,
      admin: member.admin ?? false,
      instructor: member.instructor ?? false,
      accountant: member.accountant ?? false,
      orientation: member.oriented === true ? new Date('2025-03-14T00:00:00Z') : null,
      cardAccess: member.cardSlot !== undefined,
      phone: '480 555 0100',
      postalCode: '85201',
      emergencyName: 'R. Rivera',
      emergencyPhone: '480 555 0143',
    })

    await db.insert(account).values({
      id: `${member.id}-credential`,
      userId: member.id,
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: member.id,
      password: hash,
    })
  }
}

/** The cards, certifications and payments that hang off a member. */
async function insertMemberDetail(db: Db, toolId: Map<string, number>): Promise<void> {
  for (const member of MEMBERS) {
    if (member.cardSlot !== undefined) {
      await db.insert(cards).values({
        id: member.cardSlot,
        cardNumber: member.cardSlot.toString(16).toUpperCase().padStart(8, '0'),
        userId: member.id,
        label: `${member.name.split(' ')[0]}'s fob`,
        permissions: 1,
      })
    }

    for (const slug of member.certifications ?? []) {
      const certificationId = toolId.get(slug)
      if (certificationId === undefined) continue
      await db
        .insert(userCertifications)
        .values({ userId: member.id, certificationId, grantedById: 'seed-jules' })
    }

    if (member.memberLevel >= 25) {
      await db.insert(payments).values({
        userId: member.id,
        amountCents: member.memberLevel * 100,
        paidOn: new Date().toISOString().slice(0, 10),
        recordedById: 'seed-ari',
        note: 'Zelle',
      })
    }
  }
}

/** A few rows on the screens that would otherwise be empty. */
async function insertActivity(db: Db): Promise<void> {
  await db.insert(auditLog).values([
      { actorId: 'seed-dana', action: 'card.assign', targetId: 'seed-sam', detail: { slot: 41 } },
      {
        actorId: 'seed-jules',
        action: 'certification.grant',
        targetId: 'seed-sam',
        detail: { slug: 'laser' },
      },
      {
        actorId: 'seed-dana',
        action: 'card_access.on',
        targetId: 'seed-kit',
        detail: { cardAccess: true },
      },
    ])

  await db.insert(doorEvents).values({
    kind: 'status',
    detail: { frontLocked: false, rearLocked: true, armed: false },
  })
}

function rolesOf(member: SeedMember): string {
  const roles = [
    member.admin === true ? 'admin' : '',
    member.instructor === true ? 'instructor' : '',
    member.accountant === true ? 'accountant' : '',
  ].filter(Boolean)

  return roles.length > 0 ? roles.join(', ') : 'member'
}

function announce(origin: string): void {
  console.log(`Seeded ${MEMBERS.length} invented members and ${TOOLS.length} certifications.`)
  console.log('')
  console.log(`  Sign in at ${origin} with any of these, password: ${PASSWORD}`)

  for (const member of MEMBERS.slice(0, 4)) {
    console.log(`    ${emailFor(member.name).padEnd(24)} ${rolesOf(member)}`)
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const { db, pool } = createDatabase(config)

  try {
    const existing = await db.select({ id: user.id }).from(user).limit(1)
    if (existing.length > 0) {
      console.error(
        'The database already holds members, so nothing was written. Seed data is for an empty ' +
          'local database. Run `make reset` to start over.',
      )
      process.exitCode = 1
      return
    }

    const toolId = await insertTools(db)
    await insertMembers(db, await bcrypt.hash(PASSWORD, 10))
    await insertMemberDetail(db, toolId)
    await insertActivity(db)
    announce(config.publicOrigin)
  } finally {
    await pool.end()
  }
}

await main()
