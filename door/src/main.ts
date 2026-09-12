import { createServer } from 'node:http'

import type { DoorAdapter } from './adapter.ts'
import { createFakeDevice, fakeAdapter } from './adapters/fake.ts'
import { createOpenAccess, httpTransport } from './adapters/openaccess.ts'
import { createLink } from './link.ts'
import { memo, tick } from './loop.ts'

/**
 * One process on the lab VLAN. No HTTP server except a health check bound to
 * localhost. It is a loop that makes outbound HTTPS calls to the API and speaks
 * whatever the controller speaks.
 *
 * It stores nothing. Reimage the host, give it these variables, and it is back.
 */

function log(entry: { evt: string } & Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set, so the door service did not start.`)
  }
  return value
}

/**
 * A whole number, or the process does not start.
 *
 * `setInterval(fn, NaN)` runs every millisecond, measured on node 24.20. A
 * TICK_SECONDS nobody typed correctly would turn this loop into a flood against
 * the API and against a single threaded 2013 board, which is the opposite of
 * what a poll interval is for.
 */
function count(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} is ${raw}, which is not a whole number. The door service did not start.`)
  }
  return value
}

const config = {
  apiUrl: required('API_URL').replace(/\/$/, ''),
  serviceToken: required('SERVICE_TOKEN'),
  controllerId: required('CONTROLLER_ID'),
  controllerUrl: process.env.CONTROLLER_URL ?? '',
  controllerPassword: process.env.CONTROLLER_PASSWORD ?? '',
  /** openaccess for the board the lab owns, fake for the simulator. */
  controller: process.env.CONTROLLER ?? 'openaccess',
  /** Controller door 1 and door 2, in that order. */
  doors: (process.env.DOOR_ORDER ?? 'front,rear')
    .split(',')
    .map((door) => door.trim())
    .filter((door) => door !== ''),
  tickSeconds: count('TICK_SECONDS', 5),
  healthPort: count('HEALTH_PORT', 9000),
}

/**
 * The board reads exactly four characters after `e=` and parses them as hex,
 * firmware lines 346 to 348, against PRIVPASSWORD at line 112. Sending the
 * sketch's own literal `0x1234` makes it read `0x12` and answer authfail with
 * nothing to say why. `0000` is the value the chained logout sends, line 617,
 * so it can never be a working password.
 */
function checkPassword(password: string): void {
  if (!/^[0-9a-fA-F]{4}$/.test(password) || password === '0000') {
    throw new Error(
      'CONTROLLER_PASSWORD is the four hex characters the board compares, such as 1234, and not ' +
        'the C literal 0x1234 and not 0000. The door service did not start.',
    )
  }
}

function buildAdapter(): DoorAdapter {
  const doors: [string, string] = [config.doors[0] ?? 'front', config.doors[1] ?? 'rear']
  checkPassword(config.controllerPassword)

  if (config.controller === 'fake') {
    log({ evt: 'using_simulated_controller' })
    return fakeAdapter(createFakeDevice({ password: config.controllerPassword }), config.controllerPassword, doors)
  }
  if (config.controller !== 'openaccess') {
    throw new Error(`CONTROLLER is openaccess or fake, not ${config.controller}.`)
  }
  if (config.controllerUrl === '') {
    throw new Error('CONTROLLER_URL is not set, so the door service did not start.')
  }

  return createOpenAccess({
    password: config.controllerPassword,
    transport: httpTransport(config.controllerUrl.replace(/\/$/, '')),
    doors,
  })
}

const adapter = buildAdapter()
const link = createLink({
  apiUrl: config.apiUrl,
  serviceToken: config.serviceToken,
  controllerId: config.controllerId,
})
const mem = memo()

let running = false
let lastTickAt: string | null = null
let lastError: string | null = null

/**
 * A tick that is still going when the next one is due is skipped rather than
 * stacked. The board is single threaded and arming it takes six seconds, so
 * overlapping passes would queue behind each other and never catch up.
 */
async function pass(): Promise<void> {
  if (running) return
  running = true
  try {
    await tick(link, adapter, mem)
    if (lastError !== null) log({ evt: 'door_link_up' })
    lastTickAt = new Date().toISOString()
    lastError = null
  } catch (error) {
    // Cards still open the door from the controller's own memory while this is
    // happening. The card table goes stale, which is the correct failure.
    if (lastError === null) log({ evt: 'door_link_down', message: String(error) })
    lastError = String(error)
  } finally {
    running = false
  }
}

/**
 * `running` says whether a pass is in flight right now, which is the difference
 * between a service that is stuck and one that is idle with an old reading.
 * A slow board takes as long as it takes: measured at 41 seconds for a first
 * pass writing two hundred cards at 200 ms a request, and nothing bounds a pass
 * as a whole. Without this the answer during one is ok, with a lastTickAt from
 * before it started, and that is the first step of the runbook.
 */
const health = createServer((_incoming, response) => {
  response
    .writeHead(lastError === null ? 200 : 503, { 'content-type': 'application/json' })
    .end(JSON.stringify({ ok: lastError === null, running, lastTickAt, lastError }))
})

// The loop is the job and this is a convenience, so a port already in use is
// worth saying and not worth stopping for. Without a listener here it is an
// uncaught exception, and a door service that exits because a health check
// could not bind is a door service that is not writing card tables.
health.on('error', (error) => log({ evt: 'health_port_unavailable', message: String(error) }))
health.listen(config.healthPort, '127.0.0.1')

setInterval(() => void pass(), config.tickSeconds * 1000)
void pass()

log({
  evt: 'door_started',
  controller: config.controllerId,
  kind: config.controller,
  api: config.apiUrl,
  tickSeconds: config.tickSeconds,
})
