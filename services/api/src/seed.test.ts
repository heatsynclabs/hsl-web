import { describe, expect, it } from 'vitest'

import { seedRefusal } from './seed.ts'

/**
 * The seed writes nine invented members, one of them an admin, all sharing a
 * password that is printed in `README.md`. An admin is a building key: they can
 * grant themselves card access and drive the doors.
 *
 * The only guard was that the database already held members, and a production
 * host has an empty database for exactly as long as it takes to run the import.
 * `README.md` ends its install block with `make seed`, so a volunteer following
 * the front page rather than `docs/operations.md` does this on the real host.
 *
 * https is the same signal the SMTP guard reads: a real deployment rather than
 * a laptop.
 */
describe('refusing to seed a real deployment', () => {
  it('refuses an https origin even when the database is empty', () => {
    expect(seedRefusal('https://members.heatsynclabs.org', 0)).toMatch(/deployment/)
  })

  it('names the password it would otherwise have published', () => {
    expect(seedRefusal('https://members.heatsynclabs.org', 0)).toContain('heatsync')
  })

  it('allows a laptop, because http is not a deployment', () => {
    expect(seedRefusal('http://localhost:9080', 0)).toBeNull()
  })

  it('still refuses a database that already holds members', () => {
    expect(seedRefusal('http://localhost:9080', 1)).toMatch(/already holds members/)
  })
})
