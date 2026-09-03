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

export function createHttpTransport(baseUrl: string): ControllerTransport {
  return async (query: string): Promise<string> => {
    const response = await fetch(`${baseUrl}${query}`)
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

function refusedWrite(parameter: string, body: string): Error {
  return new Error(
    `The controller refused ${redactPassword(parameter)} and the card table was not changed. ` +
      `It said: ${body.split('\n')[0]?.trim().slice(0, 120) ?? ''}`,
  )
}
