import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClient } from './client.ts'
import { ApiError } from './errors.ts'
import { meBody } from './test-fixtures.ts'

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const client = createClient({ baseUrl: 'https://members.example.org' })

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('a call that works', () => {
  it('gives back the member, the cards and the payments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(200, meBody)))

    const me = await client.me()

    expect(me.member.name).toBe('Ada Testwell')
    expect(me.cards[0]?.slot).toBe(14)
    expect(me.paymentStatus).toBe('paid')
  })

  it('sends the session cookie', async () => {
    const fetched = vi.fn(async () => answer(200, meBody))
    vi.stubGlobal('fetch', fetched)

    await client.me()

    expect(fetched).toHaveBeenCalledWith('https://members.example.org/api/me', {
      method: 'GET',
      credentials: 'include',
      headers: undefined,
      body: undefined,
    })
  })

  it('sends a card as JSON to the route that assigns the slot', async () => {
    let sent: RequestInit | undefined
    const card = {
      slot: 15,
      cardNumber: '00A1B2C4',
      userId: 'mbr_kit',
      label: null,
      permissions: 1,
      active: true,
    }
    const fetched = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init
      return answer(201, { card, memberHasCardAccess: true })
    })
    vi.stubGlobal('fetch', fetched)

    const created = await client.assignCard({ userId: 'mbr_kit', cardNumber: '00A1B2C4' })

    expect(created.card.slot).toBe(15)
    expect(sent).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{"userId":"mbr_kit","cardNumber":"00A1B2C4"}',
    })
  })
})

describe('a call the API refuses', () => {
  it('throws with the status, the API sentence and what to do next', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(403, { error: 'Only an admin may read another member' })),
    )

    const thrown = await client.member('mbr_kit').catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    const failure = thrown as ApiError
    expect(failure.status).toBe(403)
    expect(failure.problem).toBe('Only an admin may read another member')
    expect(failure.body).toEqual({ error: 'Only an admin may read another member' })
    expect(failure.message).toContain('GET /api/members/mbr_kit was refused with 403')
    expect(failure.message).toContain('Only an admin may read another member')
    expect(failure.message).toContain('Ask an admin')
  })

  it('says the lab link is down when door control answers 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(503, { error: 'door service unreachable' })))

    const thrown = await client
      .controlDoor({ command: 'open-front' })
      .catch((error: unknown) => error)

    expect((thrown as ApiError).message).toContain('Physical cards still work')
  })
})

describe('an answer that does not match the contract', () => {
  it('throws rather than hand back a half filled member', async () => {
    const wrong = { ...meBody, member: { ...meBody.member, email: 'not an address' } }
    vi.stubGlobal('fetch', vi.fn(async () => answer(200, wrong)))

    const thrown = await client.me().catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    const failure = thrown as ApiError
    expect(failure.status).toBe(200)
    expect(failure.message).toContain('member.email')
    expect(failure.message).toContain('Make the route and the schema agree')
  })

  it('throws when a field the screen needs is missing altogether', async () => {
    const { paymentStatus: _dropped, ...missing } = meBody
    vi.stubGlobal('fetch', vi.fn(async () => answer(200, missing)))

    await expect(client.me()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('an API that does not answer', () => {
  it('throws something a volunteer can act on rather than "failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))))

    const thrown = await client.doorStatus().catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    expect((thrown as ApiError).status).toBe(0)
    expect((thrown as ApiError).message).toContain('got no response at all')
  })
})
