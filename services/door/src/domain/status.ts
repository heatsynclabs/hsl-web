import { doorStatus, type DoorStatus } from '@hsl/schema'
import { z } from 'zod'

/**
 * The ?9 payload exactly as the firmware writes it, which is why the keys are
 * snake case here and nowhere else.
 */
const controllerStatusPayload = z.object({
  armed: z.number().int(),
  activated: z.number().int(),
  alarm_2: z.number().int(),
  alarm_3: z.number().int(),
  door_1_locked: z.number().int(),
  door_2_locked: z.number().int(),
})

/**
 * door_1 is the front door and door_2 the rear, matching the o1 and o2
 * commands. DoorLog.show_status reads 0 as unlocked and anything else as
 * locked, so this does the same.
 */
export function parseStatus(body: string): DoorStatus {
  const payload = controllerStatusPayload.safeParse(parseJson(body))
  if (!payload.success) {
    throw new Error(
      'The controller answered ?9 with something that is not a status document, so the door ' +
        `service kept the status it already had. It said: ${firstLine(body)}`,
    )
  }

  return doorStatus.parse({
    frontLocked: payload.data.door_1_locked !== 0,
    rearLocked: payload.data.door_2_locked !== 0,
    armed: payload.data.armed,
    activated: payload.data.activated,
    alarm2: payload.data.alarm_2,
    alarm3: payload.data.alarm_3,
  })
}

/**
 * The status document out of a response body.
 *
 * Every command this service sends chains the login onto it, and the board
 * prints "authok" before it runs the command, firmware line 349. So a chained
 * ?9 answers "authok" and then the payload, and parsing the whole body throws
 * on the very first character. The document is taken from the first brace to
 * the last instead.
 */
function parseJson(body: string): unknown {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end < start) return null

  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

function firstLine(body: string): string {
  return body.split(/\r?\n/)[0]?.trim().slice(0, 120) ?? ''
}
