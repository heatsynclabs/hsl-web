import { createClient } from '@hsl/api-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  errorsOn,
  fieldErrors,
  join,
  leaveStep,
  resetJoin,
  submitJoin,
  TIER_CHOICES,
} from './join-flow.ts'

const client = createClient({ baseUrl: '' })

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** An invented person. Nobody at the lab is called this. */
function fillIn(): void {
  join.draft.name = 'Ash Invented'
  join.draft.email = 'ash.invented@example.org'
  join.draft.password = 'a long enough password'
  join.draft.phone = '480 555 0199'
  join.draft.emergencyName = 'Fen Invented'
  join.draft.emergencyPhone = '480 555 0198'
  join.draft.waiverAccepted = true
  join.draft.memberLevel = 50
}

interface SeenRequest {
  url: string
  init?: RequestInit
}

/** Stands in for the API and keeps what was sent, so a test can read the body. */
function stubApi(reply: () => Promise<Response>): SeenRequest[] {
  const seen: SeenRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init })
      return reply()
    }),
  )
  return seen
}

function bodyOf(request: SeenRequest | undefined): Record<string, unknown> {
  return JSON.parse(String(request?.init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  vi.unstubAllGlobals()
  resetJoin()
})

describe('what the schema refuses', () => {
  it('names the field rather than dropping one banner at the top', () => {
    const errors = fieldErrors(join.draft)

    expect(errors.name).toContain('name the lab should have')
    expect(errors.email).toContain('email address')
    expect(errors.password).toContain('8 characters')
  })

  it('says nothing until somebody tries to leave the step', () => {
    expect(errorsOn('account')).toEqual({})

    const moved = leaveStep('account')

    expect(moved).toBe(false)
    expect(Object.keys(errorsOn('account'))).toEqual(['name', 'email', 'password'])
  })

  it('lets a filled in step go on, and holds nothing against the optional fields', () => {
    fillIn()
    join.draft.phone = ''
    join.draft.emergencyName = ''
    join.draft.emergencyPhone = ''

    expect(leaveStep('account')).toBe(true)
    expect(leaveStep('emergency')).toBe(true)
  })
})

describe('the tiers on offer', () => {
  it('offers the three dues tiers and volunteer, in that order', () => {
    expect(TIER_CHOICES.map((choice) => choice.level)).toEqual([25, 50, 100, 10])
  })

  it('names each one the way the members database does, with what it costs', () => {
    expect(TIER_CHOICES[0]).toEqual({ level: 25, label: 'Associate ($25)', dues: '$25 a month' })
    expect(TIER_CHOICES[3]).toEqual({ level: 10, label: 'Volunteer', dues: 'No dues' })
  })
})

describe('sending the application', () => {
  it('sends nothing at all until the last step', () => {
    const seen = stubApi(async () => answer(201, {}))
    fillIn()

    leaveStep('account')
    leaveStep('emergency')
    leaveStep('waiver')

    expect(seen).toHaveLength(0)
  })

  it('sends everything in one request', async () => {
    const created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    const seen = stubApi(async () => answer(201, created))
    fillIn()

    const sent = await submitJoin(client)

    expect(sent).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('/api/signup')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(bodyOf(seen[0])).toEqual({
      name: 'Ash Invented',
      email: 'ash.invented@example.org',
      password: 'a long enough password',
      phone: '480 555 0199',
      emergencyName: 'Fen Invented',
      emergencyPhone: '480 555 0198',
      memberLevel: 50,
      waiverAccepted: true,
    })
    expect(join.created).toEqual(created)
  })

  it('leaves a blank optional field out rather than sending an empty string', async () => {
    const seen = stubApi(async () => answer(201, { id: 'mbr_new', email: 'a@example.org' }))
    fillIn()
    join.draft.phone = '   '
    join.draft.emergencyName = ''
    join.draft.emergencyPhone = ''

    await submitJoin(client)

    const body = bodyOf(seen[0])
    expect('phone' in body).toBe(false)
    expect('emergencyName' in body).toBe(false)
  })

  it('will not send an application whose waiver was never ticked', async () => {
    const seen = stubApi(async () => answer(201, {}))
    fillIn()
    join.draft.waiverAccepted = false

    const sent = await submitJoin(client)

    expect(sent).toBe(false)
    expect(seen).toHaveLength(0)
    expect(errorsOn('waiver').waiverAccepted).toContain('Tick the box')
  })
})

describe('when the API refuses', () => {
  it('offers sign in for an email that already has an account', async () => {
    stubApi(async () => answer(409, { error: 'An account already exists for that email' }))
    fillIn()

    const sent = await submitJoin(client)

    expect(sent).toBe(false)
    expect(join.created).toBeNull()
    expect(join.failure?.offerSignIn).toBe(true)
    expect(join.failure?.message).toContain('Sign in with it')
    expect(join.failure?.message).not.toContain('409')
  })

  it('says what to do when the API does not answer at all', async () => {
    stubApi(async () => Promise.reject(new TypeError('failed to fetch')))
    fillIn()

    await submitJoin(client)

    expect(join.failure?.offerSignIn).toBe(false)
    expect(join.failure?.message).toContain('got no response at all')
    expect(join.submitting).toBe(false)
  })
})
