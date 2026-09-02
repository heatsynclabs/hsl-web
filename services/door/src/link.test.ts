import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { createApiLink, CARD_TABLE_PATH, REPORT_PATH } from './link.ts'

const TOKEN = 'door-token-for-tests'

const LOCKED = {
  frontLocked: true,
  rearLocked: true,
  armed: 255,
  activated: 255,
  alarm2: 1,
  alarm3: 1,
}

interface StubApi {
  app: Hono
  authorizations: string[]
  reports: unknown[]
}

/** A stand in for services/api, so the link is exercised over real requests. */
function stubApi(cards: unknown[]): StubApi {
  const stub: StubApi = { app: new Hono(), authorizations: [], reports: [] }

  stub.app.use('*', async (context, next) => {
    stub.authorizations.push(context.req.header('authorization') ?? '')
    await next()
  })
  stub.app.get(CARD_TABLE_PATH, (context) =>
    context.json({ generatedAt: '2026-09-01T00:00:00.000Z', cards }),
  )
  stub.app.post(REPORT_PATH, async (context) => {
    const body = await context.req.json()
    stub.reports.push(body)
    return context.json({ eventsRecorded: (body as { events: unknown[] }).events.length })
  })
  stub.app.get('/api/door/commands', (context) => context.json({ commands: ['open-front'] }))

  return stub
}

function linkTo(stub: StubApi) {
  return createApiLink({
    apiUrl: 'http://api.test',
    doorToken: TOKEN,
    fetchImpl: ((input: string | URL, init?: RequestInit) =>
      stub.app.request(String(input), init)) as typeof fetch,
  })
}

describe('fetching the card table', () => {
  it('carries the door token, the one credential the two hosts share', async () => {
    const stub = stubApi([])
    await linkTo(stub).fetchCardTable()
    expect(stub.authorizations).toEqual([`Bearer ${TOKEN}`])
  })

  it('reads the rows the API sent', async () => {
    const stub = stubApi([{ slot: 14, cardNumber: '0001E240', permissions: 1 }])
    const table = await linkTo(stub).fetchCardTable()
    expect(table.cards).toEqual([{ slot: 14, cardNumber: '0001E240', permissions: 1 }])
    expect(table.unreadableRows).toBe(0)
  })

  it('keeps the rows it can read when one row is unreadable', async () => {
    const stub = stubApi([
      { slot: 14, cardNumber: '0001E240', permissions: 1 },
      { slot: 'fifteen', cardNumber: '00ABCDEF', permissions: 1 },
    ])
    const table = await linkTo(stub).fetchCardTable()
    expect(table.cards.map((card) => card.slot)).toEqual([14])
    expect(table.unreadableRows).toBe(1)
  })

  it('says the card table is unchanged when the API refuses', async () => {
    const link = createApiLink({
      apiUrl: 'http://api.test',
      doorToken: TOKEN,
      fetchImpl: (() => Promise.resolve(new Response('no', { status: 401 }))) as typeof fetch,
    })
    await expect(link.fetchCardTable()).rejects.toThrow(/still open the door/)
  })
})

describe('posting back', () => {
  it('sends the status and the events, and reports what the API recorded', async () => {
    const stub = stubApi([])
    const recorded = await linkTo(stub).postReport({
      status: LOCKED,
      events: [{ kind: 'controller-log', at: '2026-09-01T00:00:00.000Z', detail: { key: 'G' } }],
    })

    expect(recorded).toBe(1)
    expect(stub.reports[0]).toMatchObject({ status: LOCKED, events: [{ kind: 'controller-log' }] })
  })

  it('picks up the commands the API queued', async () => {
    expect(await linkTo(stubApi([])).fetchCommands()).toEqual(['open-front'])
  })
})
