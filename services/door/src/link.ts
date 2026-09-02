import { doorCommand, doorEventReport, type DoorCommand, type DoorStatus } from '@hsl/schema'
import { z } from 'zod'

import type { CardTableRow } from './domain/reconcile.ts'

type DoorEventReport = z.infer<typeof doorEventReport>

/**
 * The connection to the members API. Everything here is outbound: the door
 * service opens the socket, and nothing on the public internet reaches into the
 * lab. See docs/decisions/0005.
 *
 * When the API is unreachable every call here throws, the loop logs it and
 * keeps its last card table, and physical cards go on opening the door. That is
 * the designed failure and it is not urgent.
 *
 * ASSUMPTION: the API serves these three paths. services/api is not written
 * yet, so they are named here first.
 * CONFIRM BY: reading the route table in docs/architecture.md once the two
 * door service routes are built.
 * BLAST RADIUS: the card table never arrives and remote control returns 503.
 */
export const CARD_TABLE_PATH = '/api/door/card-table'
export const REPORT_PATH = '/api/door/report'
export const COMMANDS_PATH = '/api/door/commands'

/**
 * Rows are validated one at a time rather than as a batch. One row the door
 * service cannot read must not cost the other sixty three their door access.
 */
const cardTableRow = z.object({
  slot: z.number().int(),
  cardNumber: z.string(),
  permissions: z.number().int(),
})

const cardTableEnvelope = z.object({
  generatedAt: z.string(),
  cards: z.array(z.unknown()),
})

const pendingCommands = z.object({ commands: z.array(doorCommand) })

export interface CardTable {
  generatedAt: string
  cards: CardTableRow[]
  /** Rows the API sent that this service could not read. Reported, not guessed at. */
  unreadableRows: number
}

export interface ApiLink {
  fetchCardTable(): Promise<CardTable>
  fetchCommands(): Promise<DoorCommand[]>
  postReport(report: { status: DoorStatus; events: DoorEventReport[] }): Promise<number>
}

export interface ApiLinkOptions {
  apiUrl: string
  doorToken: string
  /** Injected so the tests drive a real link against a stub server rather than a mock. */
  fetchImpl?: typeof fetch
}

export function createApiLink(options: ApiLinkOptions): ApiLink {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const send = options.fetchImpl ?? fetch
    const response = await send(`${options.apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.doorToken}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    })
    if (!response.ok) {
      throw new Error(
        `The members API answered ${response.status} to ${path}. The door service kept the ` +
          'card table it already has and cards already on the controller still open the door.',
      )
    }
    return response.json()
  }

  return {
    async fetchCardTable(): Promise<CardTable> {
      const envelope = cardTableEnvelope.parse(await call(CARD_TABLE_PATH))
      const cards: CardTableRow[] = []
      let unreadableRows = 0
      for (const row of envelope.cards) {
        const parsed = cardTableRow.safeParse(row)
        if (parsed.success) cards.push(parsed.data)
        else unreadableRows += 1
      }
      return { generatedAt: envelope.generatedAt, cards, unreadableRows }
    },

    async fetchCommands(): Promise<DoorCommand[]> {
      return pendingCommands.parse(await call(COMMANDS_PATH)).commands
    },

    async postReport(report): Promise<number> {
      const body = JSON.stringify({
        reportedAt: new Date().toISOString(),
        status: report.status,
        events: report.events,
      })
      const answer = await call(REPORT_PATH, { method: 'POST', body })
      return z.object({ eventsRecorded: z.number().int() }).parse(answer).eventsRecorded
    },
  }
}
