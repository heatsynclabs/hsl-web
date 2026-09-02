import type { MemberSelf, MeResponse } from '@hsl/schema'

/**
 * Invented people and invented cards, for the suites in this package. Nobody at
 * the lab is named any of this and no card number here belongs to anything.
 * Not exported from index.ts.
 */

export const signedInMember: MemberSelf = {
  id: 'mbr_ada',
  name: 'Ada Testwell',
  email: 'ada.testwell@example.org',
  emailVerified: true,
  phone: '480 555 0134',
  postalCode: '85201',
  emergencyName: 'Bo Testwell',
  emergencyPhone: '480 555 0135',
  emergencyEmail: 'bo.testwell@example.org',
  memberLevel: 50,
  memberLevelLabel: 'Basic ($50)',
  waiver: '2026-01-04T17:00:00.000Z',
  orientation: '2026-01-11T17:00:00.000Z',
  hidden: false,
  emailVisible: true,
  phoneVisible: false,
  currentSkills: 'soldering, sewing',
  desiredSkills: 'tig welding',
  paymentMethod: 'standing order',
  payee: null,
  admin: false,
  instructor: false,
  accountant: false,
  cardAccess: true,
}

export const meBody: MeResponse = {
  member: signedInMember,
  paymentStatus: 'paid',
  cards: [
    {
      slot: 14,
      cardNumber: '00A1B2C3',
      userId: 'mbr_ada',
      label: 'blue fob',
      permissions: 1,
      active: true,
    },
  ],
  certifications: [
    {
      slug: 'laser',
      name: 'Laser cutter',
      grantedAt: '2026-02-02T19:30:00.000Z',
      grantedById: 'mbr_kit',
      grantedByName: 'Kit Sample',
    },
  ],
  payments: [
    {
      id: 1,
      userId: 'mbr_ada',
      amountCents: 5000,
      paidOn: '2026-08-04',
      note: null,
      recordedById: 'mbr_kit',
      createdAt: '2026-08-04T20:00:00.000Z',
    },
  ],
}
