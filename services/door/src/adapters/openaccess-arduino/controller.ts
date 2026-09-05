import type { Door, DoorCommand } from '@hsl/schema'

import { parseStatus } from '../../domain/status.ts'
import type { ControllerTransport, DoorAdapter } from '../types.ts'
import {
  chained,
  clearSlotParameter,
  CLEAR_LOG_PARAMETER,
  COMMAND_PARAMETERS,
  DUMP_CARD_TABLE_PARAMETER,
  isWriteAccepted,
  parseCardTable,
  parseLog,
  READ_LOG_PARAMETER,
  redactPassword,
  showSlotParameter,
  STATUS_PARAMETER,
  writeCardParameter,
} from './wire.ts'

export interface ArduinoControllerOptions {
  password: string
  transport: ControllerTransport
}

const LOCK_COMMANDS: Record<Door | 'all', Record<'lock' | 'unlock', DoorCommand>> = {
  all: { lock: 'lock', unlock: 'unlock' },
  front: { lock: 'lock-front', unlock: 'unlock-front' },
  rear: { lock: 'lock-rear', unlock: 'unlock-rear' },
}

/**
 * The adapter the lab owns this year. It speaks the query string protocol and
 * holds no policy: the rear unlock refusal and the slot rules live above it, so
 * they survive the next controller.
 */
export function createArduinoController(options: ArduinoControllerOptions): DoorAdapter {
  const send = (parameter: string): Promise<string> =>
    options.transport(chained(parameter, options.password))

  return {
    status: async () => parseStatus(await send(STATUS_PARAMETER)),

    open: async (door) => {
      await send(COMMAND_PARAMETERS[door === 'front' ? 'open-front' : 'open-rear'])
    },

    setLock: async (door, locked) => {
      await send(COMMAND_PARAMETERS[LOCK_COMMANDS[door][locked ? 'lock' : 'unlock']])
    },

    setAlarm: async (armed) => {
      await send(COMMAND_PARAMETERS[armed ? 'arm' : 'disarm'])
    },

    writeCard: async (slot, permissions, tag) => {
      const parameter = writeCardParameter({ slot, permissions, cardNumber: tag })
      const body = await send(parameter)
      if (!isWriteAccepted(body)) throw refusedWrite(parameter, body)
    },

    clearCard: async (slot) => {
      const parameter = clearSlotParameter(slot)
      const body = await send(parameter)
      if (!isWriteAccepted(body)) throw refusedWrite(parameter, body)
    },

    readLog: async () => parseLog(await send(READ_LOG_PARAMETER)),

    clearLog: async () => {
      await send(CLEAR_LOG_PARAMETER)
    },

    readCardTable: async () => parseCardTable(await send(DUMP_CARD_TABLE_PARAMETER)),

    /**
     * ?sNNN answers with the chained login line, a pre block, a header and then
     * the row. Reading the first line only would read "authok" every time, so
     * the whole body is scanned the way the dump is.
     */
    readCard: async (slot) => parseCardTable(await send(showSlotParameter(slot)))[0] ?? null,
  }
}

/**
 * How long to wait for the board before giving up on one request.
 *
 * It has to be longer than the slowest honest answer and shorter than a
 * reconcile pass. Arming calls chirpAlarm twenty times at 300 ms, firmware line
 * 517, so about six seconds is legitimate, and RECONCILE_INTERVAL_SECONDS
 * defaults to sixty. Without a timeout node waits on undici's default of 300
 * seconds, measured on node:24.20-alpine: five minutes in which the loop's
 * running guard skips every tick, the API's status goes stale after two, remote
 * control answers 503 and the public page reads closed. A wedged board is the
 * ordinary failure of a 2013 Arduino on a shared LAN, so it must not be the one
 * that blinds the service.
 */
export const CONTROLLER_TIMEOUT_MS = 15_000

export function createHttpTransport(
  baseUrl: string,
  timeoutMs: number = CONTROLLER_TIMEOUT_MS,
): ControllerTransport {
  return async (query: string): Promise<string> => {
    const response = await fetch(`${baseUrl}${query}`, {
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((cause: unknown) => {
      throw new Error(unreachable(query, timeoutMs, cause), { cause })
    })
    if (!response.ok) {
      throw new Error(
        `The controller answered ${response.status} to ${redactPassword(query)}. Every ` +
          'controller response is normally 200, so the address in CONTROLLER_URL is probably ' +
          'not the controller.',
      )
    }
    return response.text()
  }
}

/** AbortSignal.timeout rejects with a DOMException named TimeoutError, checked. */
function isTimeout(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'TimeoutError'
}

/**
 * Two different failures with two different answers. A timeout means the board
 * took the connection and stopped talking, which is what a wedged Arduino looks
 * like and what a power cycle fixes. Anything else means nothing was listening,
 * which is a wrong address or a board that is off.
 */
function unreachable(query: string, timeoutMs: number, cause: unknown): string {
  const where = redactPassword(query)
  const kept =
    'Nothing was changed and cards already on the controller still open the door.'

  if (isTimeout(cause)) {
    return (
      `The controller accepted the connection and then did not answer ${where} within ` +
      `${timeoutMs / 1000} seconds. ${kept} It is wedged rather than absent, so power cycle it.`
    )
  }

  return (
    `The controller could not be reached for ${where}. ${kept} Check that it is powered and on ` +
    'the LAN, and that CONTROLLER_URL names it.'
  )
}

function refusedWrite(parameter: string, body: string): Error {
  return new Error(
    `The controller refused ${redactPassword(parameter)} and the card table was not changed. ` +
      `It said: ${body.split('\n')[0]?.trim().slice(0, 120) ?? ''}`,
  )
}
