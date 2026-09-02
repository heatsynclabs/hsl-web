import { describe, expect, it } from 'vitest'

import { doorControlRequest, patchMeRequest, spaceApiResponse } from './contracts.ts'

describe('patchMeRequest', () => {
  it('takes the contact fields and the visibility switches', () => {
    const parsed = patchMeRequest.parse({
      phone: '480 555 0134',
      emailVisible: false,
      hidden: true,
    })
    expect(parsed.phone).toBe('480 555 0134')
  })

  it('refuses a member granting themself a role', () => {
    expect(patchMeRequest.safeParse({ admin: true }).success).toBe(false)
    expect(patchMeRequest.safeParse({ accountant: true }).success).toBe(false)
  })

  it('refuses a member setting their own dues tier, orientation or waiver', () => {
    expect(patchMeRequest.safeParse({ memberLevel: 100 }).success).toBe(false)
    expect(patchMeRequest.safeParse({ orientation: '2026-09-01T00:00:00Z' }).success).toBe(false)
    expect(patchMeRequest.safeParse({ waiver: '2026-09-01T00:00:00Z' }).success).toBe(false)
    expect(patchMeRequest.safeParse({ cardAccess: true }).success).toBe(false)
  })
})

describe('doorControlRequest', () => {
  it('parses unlock-rear so the route can refuse it by name', () => {
    expect(doorControlRequest.parse({ command: 'unlock-rear' }).command).toBe('unlock-rear')
  })

  it('refuses a command the controller has no parameter for', () => {
    expect(doorControlRequest.safeParse({ command: 'open-side' }).success).toBe(false)
  })
})

describe('spaceApiResponse', () => {
  it('pins the two keys the server adds and passes the template through', () => {
    const parsed = spaceApiResponse.parse({
      api: '0.12',
      space: 'HeatSync Labs',
      open: true,
      status: 'doors_open=both',
    })
    expect(parsed.open).toBe(true)
    expect(parsed['space']).toBe('HeatSync Labs')
  })

  it('refuses a document missing the open flag the status LED reads', () => {
    expect(spaceApiResponse.safeParse({ api: '0.12', status: 'doors_open=none' }).success)
      .toBe(false)
  })
})
