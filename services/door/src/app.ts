import { timingSafeEqual } from 'node:crypto'

import { doorControlRequest, type DoorCommand } from '@hsl/schema'
import { Hono, type MiddlewareHandler } from 'hono'

import type { DoorAdapter } from './adapters/types.ts'

/**
 * The small HTTP surface the API talks to. It is bound to loopback on the lab
 * host, per infra/door/compose.yaml, and it is not the path the two hosts use
 * in production: that one is outbound from link.ts.
 */

export interface AppOptions {
  controller: DoorAdapter
  /** The one credential the two hosts share. */
  doorToken: string
}

/**
 * Rear unlock is refused by the lab decision of 2018-02-22. The refusal lives
 * here rather than in the adapter so it holds whatever hardware is underneath.
 * The API refuses it too, so a member sees a sentence instead of a service they
 * cannot reach answering 403; this is the last refusal before the hardware.
 */
export const REFUSED_COMMANDS: Partial<Record<DoorCommand, string>> = {
  'unlock-rear':
    'Holding the rear door unlocked is refused by the lab decision of 2018-02-22. Nothing was ' +
    'sent to the controller. Use open-rear to pulse the strike instead.',
}

const COMMAND_ACTIONS: Record<DoorCommand, (controller: DoorAdapter) => Promise<void>> = {
  'open-front': (controller) => controller.open('front'),
  'open-rear': (controller) => controller.open('rear'),
  unlock: (controller) => controller.setLock('all', false),
  'unlock-front': (controller) => controller.setLock('front', false),
  'unlock-rear': (controller) => controller.setLock('rear', false),
  lock: (controller) => controller.setLock('all', true),
  'lock-front': (controller) => controller.setLock('front', true),
  'lock-rear': (controller) => controller.setLock('rear', true),
  arm: (controller) => controller.setAlarm(true),
  disarm: (controller) => controller.setAlarm(false),
}

/**
 * Runs one command, or returns why it was refused and touches nothing. Both the
 * control route and the command the loop picks up from the API come through
 * here, so the refusal is checked in exactly one place.
 */
export async function runDoorCommand(
  controller: DoorAdapter,
  command: DoorCommand,
): Promise<string | null> {
  const refusal = REFUSED_COMMANDS[command]
  if (refusal !== undefined) return refusal
  await COMMAND_ACTIONS[command](controller)
  return null
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono()

  // Unauthenticated on purpose: the compose healthcheck reads it and it says
  // nothing about the building.
  app.get('/healthz', (context) => context.json({ ok: true, service: 'door' }))

  app.use('/status', bearerToken(options.doorToken))
  app.use('/control', bearerToken(options.doorToken))

  app.get('/status', async (context) => {
    try {
      return context.json({ status: await options.controller.status(), readAt: nowIso() })
    } catch (error) {
      return context.json({ error: describe(error) }, 503)
    }
  })

  app.post('/control', async (context) => {
    const parsed = doorControlRequest.safeParse(await readJson(context.req.raw))
    if (!parsed.success) {
      return context.json({ error: 'That is not a door command. Nothing was sent.' }, 400)
    }

    const command = parsed.data.command
    try {
      const refused = await runDoorCommand(options.controller, command)
      if (refused !== null) return context.json({ error: refused }, 403)
      return context.json({ command, queuedAt: nowIso() })
    } catch (error) {
      return context.json({ error: describe(error) }, 503)
    }
  })

  return app
}

function bearerToken(doorToken: string): MiddlewareHandler {
  return async (context, next) => {
    const offered = (context.req.header('authorization') ?? '').replace(/^Bearer /, '')
    if (!matches(offered, doorToken)) {
      return context.json({ error: 'The door token was missing or wrong. Nothing was sent.' }, 401)
    }
    await next()
    return undefined
  }
}

function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The controller could not be reached.'
}

function nowIso(): string {
  return new Date().toISOString()
}
