import type {
  AuditEntry,
  CardRecord,
  CardTableViewResponse,
  DoorEventEntry,
  DoorStatusResponse,
  MemberDirectoryEntry,
  MemberResponse,
  MemberSelf,
  MeResponse,
  UnknownCard,
} from '@hsl/schema'

/**
 * Invented people, invented cards, invented money. Nobody at the lab is named
 * any of this. Only the suites in this app import it.
 */

export const directoryEntries: MemberDirectoryEntry[] = [
  {
    id: 'mbr_rivera',
    name: 'Sam Rivera',
    email: 'sam.rivera@example.org',
    phone: null,
    memberLevelLabel: 'Basic ($50)',
    certifications: ['laser'],
  },
  {
    id: 'mbr_tanaka',
    name: 'J. Tanaka',
    email: null,
    phone: null,
    memberLevelLabel: 'Associate ($25)',
    certifications: [],
  },
  {
    id: 'mbr_volkov',
    name: 'M. Volkov',
    email: 'm.volkov@example.org',
    phone: null,
    memberLevelLabel: 'Basic ($50)',
    certifications: [],
  },
]

export const activeCard: CardRecord = {
  slot: 41,
  cardNumber: '0000A1B2',
  userId: 'mbr_rivera',
  label: 'blue fob',
  permissions: 1,
  active: true,
}

export const deactivatedCard: CardRecord = {
  slot: 17,
  cardNumber: '0000C4D9',
  userId: 'mbr_volkov',
  label: null,
  permissions: 1,
  active: false,
}

export const memberSelf: MemberSelf = {
  id: 'mbr_rivera',
  name: 'Sam Rivera',
  email: 'sam.rivera@example.org',
  emailVerified: true,
  phone: null,
  postalCode: null,
  emergencyName: null,
  emergencyPhone: null,
  emergencyEmail: null,
  memberLevel: 50,
  memberLevelLabel: 'Basic ($50)',
  waiver: '2026-01-04T17:00:00.000Z',
  orientation: '2026-01-11T17:00:00.000Z',
  hidden: false,
  emailVisible: true,
  phoneVisible: false,
  currentSkills: null,
  desiredSkills: null,
  paymentMethod: null,
  payee: null,
  admin: false,
  instructor: false,
  accountant: false,
  cardAccess: true,
}

export const memberRecord: MemberResponse = {
  member: { ...memberSelf, createdAt: '2025-11-02T18:00:00.000Z', orientedById: null, legacyId: 77 },
  paymentStatus: 'paid',
  cards: [activeCard],
  certifications: [
    {
      slug: 'laser',
      name: 'Laser Cutter',
      grantedAt: '2026-02-02T19:30:00.000Z',
      grantedById: 'mbr_ortiz',
      grantedByName: 'K. Ortiz',
    },
  ],
  payments: [],
  waivers: [],
}

export const auditEntries: AuditEntry[] = [
  {
    id: 92,
    at: '2026-08-30T23:12:00.000Z',
    actorId: 'mbr_kim',
    actorName: 'D. Kim',
    action: 'card.assign',
    targetId: 'mbr_tanaka',
    detail: { slot: 42, permissions: 1 },
  },
  {
    id: 91,
    at: '2026-08-30T22:04:00.000Z',
    actorId: 'mbr_kim',
    actorName: 'D. Kim',
    action: 'member.update',
    targetId: 'mbr_rivera',
    detail: { changed: { cardAccess: true }, previous: { cardAccess: false } },
  },
]

export function meBody(overrides: Partial<MemberSelf> = {}): MeResponse {
  return {
    member: { ...memberSelf, ...overrides },
    paymentStatus: 'paid',
    cards: [],
    certifications: [],
    payments: [],
  }
}

export const unknownCards: UnknownCard[] = [
  {
    cardNumber: '0004B1C7',
    outcome: 'denied',
    timesSeen: 3,
    firstSeen: '2026-09-01T17:40:00.000Z',
    lastSeen: '2026-09-01T17:44:00.000Z',
  },
  {
    cardNumber: '00021D40',
    outcome: 'granted',
    timesSeen: 1,
    firstSeen: '2026-09-01T16:02:00.000Z',
    lastSeen: '2026-09-01T16:02:00.000Z',
  },
]

/**
 * Slot 200 is in here on purpose. Production holds one card up there, the
 * firmware writes it and never reads it, and the screen has to say so.
 */
export const cardTableView: CardTableViewResponse = {
  slots: [
    {
      slot: 17,
      cardNumber: '0000C4D9',
      memberId: 'mbr_volkov',
      memberName: 'M. Volkov',
      active: false,
      reconciled: false,
    },
    {
      slot: 41,
      cardNumber: '0000A1B2',
      memberId: 'mbr_rivera',
      memberName: 'Sam Rivera',
      active: true,
      reconciled: true,
    },
    {
      slot: 200,
      cardNumber: '0000F00D',
      memberId: 'mbr_tanaka',
      memberName: 'J. Tanaka',
      active: true,
      reconciled: true,
    },
  ],
  usedSlots: 3,
  freeSlots: 198,
  nextFreeSlot: 0,
}

export const doorEventEntries: DoorEventEntry[] = [
  {
    id: 512,
    kind: 'card-presented',
    at: '2026-09-01T17:44:00.000Z',
    detail: { cardNumber: '0004B1C7', outcome: 'denied' },
  },
  {
    id: 511,
    kind: 'card-table-synced',
    at: '2026-09-01T17:43:00.000Z',
    detail: null,
  },
  {
    id: 510,
    kind: 'weather-station-read',
    at: '2026-09-01T17:42:00.000Z',
    detail: { celsius: 31 },
  },
]

export const doorReportingLive: DoorStatusResponse = {
  status: { frontLocked: true, rearLocked: true, armed: 255, activated: 255, alarm2: 1, alarm3: 1 },
  reportedAt: '2026-09-01T17:44:00.000Z',
  stale: false,
}
