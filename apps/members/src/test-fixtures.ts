import type { ApiClient } from '@hsl/api-client'
import type { MemberSelf, MeResponse } from '@hsl/schema'

/**
 * Invented members for the suites. Nothing here came from the production dump,
 * per section 12 of CONTRIBUTING.md, and the addresses are example.org.
 */

export const SAM: MemberSelf = {
  id: 'mbr_sam',
  name: 'Sam Rivera',
  email: 'sam@example.org',
  emailVerified: true,
  phone: '480 555 0142',
  postalCode: '85201',
  emergencyName: 'R. Rivera',
  emergencyPhone: '480 555 0143',
  emergencyEmail: null,
  memberLevel: 50,
  memberLevelLabel: 'Basic ($50)',
  waiver: '2024-03-02T18:00:00.000Z',
  orientation: '2024-03-02T18:00:00.000Z',
  hidden: false,
  emailVisible: true,
  phoneVisible: false,
  currentSkills: null,
  desiredSkills: null,
  paymentMethod: 'PayPal, monthly',
  payee: null,
  admin: false,
  instructor: false,
  accountant: false,
  cardAccess: true,
}

export const SAM_ME: MeResponse = {
  member: SAM,
  paymentStatus: 'paid',
  cards: [
    {
      slot: 41,
      cardNumber: '0000A1B2',
      userId: SAM.id,
      label: 'Blue fob',
      permissions: 1,
      active: true,
    },
  ],
  certifications: [
    {
      slug: 'laser',
      name: 'Laser Cutter',
      grantedAt: '2026-05-03T17:00:00.000Z',
      grantedById: 'mbr_jo',
      grantedByName: 'J. Okafor',
    },
  ],
  payments: [
    {
      id: 1,
      userId: SAM.id,
      amountCents: 5000,
      paidOn: '2026-08-12',
      note: null,
      recordedById: null,
      createdAt: '2026-08-12T17:00:00.000Z',
    },
  ],
}

/**
 * The routes a test cares about and nothing else. A route the screen calls
 * without a stub throws, which is the failure a reader wants to see.
 */
export function stubApi(routes: Partial<ApiClient>): ApiClient {
  return routes as ApiClient
}
