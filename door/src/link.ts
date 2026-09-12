import { request } from 'undici'

import type { Card, Capability, DoorEvent, DoorState, UploadResult } from './adapter.ts'

/**
 * The six HTTP calls this service makes to the API, and the whole of what it
 * needs from the outside world.
 *
 * Outbound only. Nothing on the public internet reaches the lab VLAN, so a
 * tunnel, a mesh control plane and an inbound port are all avoided along with
 * the ways each of them fails quietly.
 */

/**
 * An Error carrying the status that came with it, so the loop can tell a
 * refusal apart from a link that is down.
 */
export interface LinkFailure extends Error {
  status?: number
}

export interface Command {
  id: string
  action: string
  door: string | null
}

export interface Link {
  fetchCards(): Promise<{ version: string; cards: Card[] }>
  postPlacements(result: UploadResult): Promise<void>
  claimCommands(): Promise<{ commands: Command[]; cardsVersion: string }>
  commandResult(id: string, outcome: string, detail?: Record<string, unknown>): Promise<void>
  postState(doors: Record<string, DoorState>, capabilities: Capability[]): Promise<void>
  postEvents(events: DoorEvent[]): Promise<void>
}

export interface LinkOptions {
  apiUrl: string
  /** `<id>.<secret>`, from POST /api/service-tokens. */
  serviceToken: string
  controllerId: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

export function createLink(options: LinkOptions): Link {
  const headers = {
    authorization: `Bearer ${options.serviceToken}`,
    'x-controller-id': options.controllerId,
    'content-type': 'application/json',
  }
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> {
    const answer = await request(`${options.apiUrl}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headersTimeout: timeout,
      bodyTimeout: timeout,
    })

    const text = await answer.body.text()
    if (answer.statusCode >= 400) {
      const failure = new Error(
        `The API answered ${answer.statusCode} to ${method} ${path}. It said: ${text.slice(0, 200)}`,
      ) as LinkFailure
      failure.status = answer.statusCode
      throw failure
    }
    return text === '' ? null : JSON.parse(text)
  }

  return {
    fetchCards: async () => (await call('GET', '/door/cards')) as { version: string; cards: Card[] },

    postPlacements: async (result) => {
      await call('POST', '/door/placements', {
        placements: result.placements,
        removed: result.removed,
      })
    },

    claimCommands: async () =>
      (await call('GET', '/door/commands')) as { commands: Command[]; cardsVersion: string },

    commandResult: async (id, outcome, detail) => {
      await call('POST', `/door/commands/${id}/result`, { outcome, detail: detail ?? null })
    },

    postState: async (doors, capabilities) => {
      await call('POST', '/door/state', { doors, capabilities, reportedAt: new Date().toISOString() })
    },

    postEvents: async (events) => {
      if (events.length > 0) await call('POST', '/door/events', { events })
    },
  }
}
