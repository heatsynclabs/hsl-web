import type { Client } from '../pg.ts'

/**
 * Invented members, invented cards, invented money. Nothing here resembles a
 * real member, a real email domain or a real card number: example.invalid is
 * reserved by RFC 2606 and can never be registered.
 *
 * The shape is chosen to cover what the import has to get right. Slots 14, 41
 * and 199 prove slot preservation, slot 200 proves the notice, the five
 * character card number proves the padding, and the member holding only the
 * mask 255 card proves that card access follows permission 1 and not a bit
 * test.
 */

/** The plaintext behind each hash below, so a test can prove the hash still verifies. */
export const FIXTURE_PASSWORDS: Record<number, string> = {
  1: 'a wrench and a soldering iron',
  2: 'the second invented password',
  4: 'a third invented password',
  5: 'a fourth invented password',
}

/** bcrypt cost 10 with the $2a$ prefix, the form Devise wrote for every real hash. */
export const FIXTURE_HASHES: Record<number, string> = {
  1: '$2a$10$ehoGzKgoN9ojlEWJzDhnJu3tywn13QmNrHbPE0ZK18p18GxgS5mWu',
  2: '$2a$10$ZanJ7NgyKbbWppCIGe8QvemN0RxIMKmFZ7HjfcowCYNJThVuZE.f.',
  4: '$2a$10$/T26Vk8yPq727gGqIuvuzuKUHVJCwO1lpiSPlEMNJvdJ/iw7Tv3OG',
  5: '$2a$10$z6gIxFexf8HPT4cfKmwjKOqr/GxeB5pxu0OFAqICeZkk7DPViml0S',
}

/** Legacy member 3 has never had a password, like the 31 in production. */
export const MEMBER_WITHOUT_A_PASSWORD = 3

export const FIXTURE_SLOTS = [14, 41, 199, 200]

/** Slot 199 holds a five character number, which pads up to eight. */
export const SHORT_CARD_NUMBER = 'abcde'
export const SHORT_CARD_NUMBER_PADDED = '000ABCDE'

/** Slot 41 carries the mask that is not 1, so its holder gets no card access. */
export const UNUSUAL_MASK = 255
export const MEMBER_HOLDING_THE_UNUSUAL_MASK = 2

const USERS = `
  insert into users (
    id, name, email, encrypted_password, phone, postal_code, member_level,
    email_visible, phone_visible, hidden, admin, instructor, accountant,
    oriented_by_id, orientation, waiver, created_at, updated_at
  ) values
    (1, 'Rivet Kestrel',   'rivet@example.invalid',   '${FIXTURE_HASHES[1]}',
     '555-0100', '85281', 50, true,  false, false, true,  false, false,
     null, '2024-03-04 17:00:00', '2024-03-04 17:05:00', '2024-03-04 16:00:00', '2026-01-02 09:00:00'),
    (2, 'Solder Wick',     'solder@example.invalid',  '${FIXTURE_HASHES[2]}',
     null, '85281', 25, false, false, false, false, true,  false,
     1, '2024-05-06 18:00:00', null, '2024-05-06 17:00:00', '2026-01-03 09:00:00'),
    (3, 'Bandsaw Quill',   'bandsaw@example.invalid', '',
     null, '85282', 100, null,  null,  null,  null,  null,  null,
     null, null, null, '2024-07-08 19:00:00', '2026-01-04 09:00:00'),
    (4, 'Lathe Marrow',    'lathe@example.invalid',   '${FIXTURE_HASHES[4]}',
     '555-0101', '85283', 25, true,  true,  true,  false, false, true,
     1, '2025-01-09 20:00:00', '2025-01-09 20:05:00', '2025-01-09 19:00:00', '2026-01-05 09:00:00'),
    (5, 'Kiln Ferrous',    'kiln@example.invalid',    '${FIXTURE_HASHES[5]}',
     null, '85284', null, false, false, false, false, false, false,
     1, null, null, '2025-02-10 21:00:00', '2026-01-06 09:00:00')
`

const CARDS = `
  insert into cards (id, card_number, card_permissions, user_id, name, created_at, updated_at) values
    (14,  'a1b2c3d4',              1,   1, 'blue fob',    '2024-03-05 10:00:00', '2024-03-05 10:00:00'),
    (41,  'beef01',                ${UNUSUAL_MASK}, ${MEMBER_HOLDING_THE_UNUSUAL_MASK},
          'white card',            '2024-05-07 10:00:00', '2024-05-07 10:00:00'),
    (199, '${SHORT_CARD_NUMBER}',  1,   3, 'short number','2024-07-09 10:00:00', '2024-07-09 10:00:00'),
    (200, '0f0f0f0',               1,   4, 'past the end','2025-01-10 10:00:00', '2025-01-10 10:00:00')
`

const CERTIFICATIONS = `
  insert into certifications (id, name, description, slug, created_at, updated_at) values
    (1, 'Bench Grinder', 'Grinding wheels and eye protection', 'benchgrinder',
     '2020-01-01 00:00:00', '2020-01-01 00:00:00'),
    (2, 'Heat Press',    'Transfers and vinyl',               'heatpress',
     '2020-01-01 00:00:00', '2020-01-01 00:00:00')
`

const USER_CERTIFICATIONS = `
  insert into user_certifications (id, user_id, certification_id, created_by, created_at, updated_at)
  values
    (1, 1, 1, 2,    '2024-04-01 12:00:00', '2024-04-01 12:00:00'),
    (2, 3, 2, null, '2024-08-01 12:00:00', '2024-08-01 12:00:00')
`

const PAYMENTS = `
  insert into payments (id, user_id, date, amount, created_by, created_at, updated_at) values
    (1, 1, '2026-01-15', 50.0,  4,    '2026-01-15 12:00:00', '2026-01-15 12:00:00'),
    (2, 2, '2026-02-01', null,  null, '2026-02-01 12:00:00', '2026-02-01 12:00:00'),
    (3, 3, '2026-03-01', 25.00, 4,    '2026-03-01 12:00:00', '2026-03-01 12:00:00')
`

const CONTRACTS = `
  insert into contracts (
    id, user_id, first_name, last_name, signed_at, document_file_name, cosigner,
    created_by_id, created_at, updated_at
  ) values
    (1, 1, 'Rivet', 'Kestrel', '2024-03-04 17:05:00', 'release-rivet.pdf', null, 4,
     '2024-03-04 17:06:00', '2024-03-04 17:06:00'),
    (2, 5, 'Kiln',  'Ferrous', null,                  null,                'Cosigner Name', null,
     '2025-02-10 21:30:00', '2025-02-10 21:30:00')
`

const EMPTY = ['contracts', 'payments', 'user_certifications', 'certifications', 'cards', 'users']

export async function seedFixture(legacy: Client): Promise<void> {
  for (const table of EMPTY) {
    await legacy.query(`delete from ${table}`)
  }

  for (const statement of [USERS, CARDS, CERTIFICATIONS, USER_CERTIFICATIONS, PAYMENTS, CONTRACTS]) {
    await legacy.query(statement)
  }
}

/** A signed release whose member is gone. Production has 65 of these. */
export async function addOrphanContract(legacy: Client): Promise<void> {
  await legacy.query(`
    insert into contracts (id, user_id, signed_at, document_file_name, created_at, updated_at)
    values (3, 9999, '2023-01-01 00:00:00', 'release-nobody.pdf',
            '2023-01-01 00:00:00', '2023-01-01 00:00:00')
  `)
}
