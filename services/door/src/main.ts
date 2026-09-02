import { pathToFileURL } from 'node:url'

import { serve } from '@hono/node-server'
import { CARD_PRESENTED, doorEventReport } from '@hsl/schema'
import type { z } from 'zod'

import { createArduinoController, createHttpTransport } from './adapters/openaccess-arduino/controller.ts'
import type { DoorAdapter } from './adapters/types.ts'
import { createApp, runDoorCommand } from './app.ts'
import { loadConfig } from './config.ts'
import {
  planReconcile,
  planIsEmpty,
  reportableEvents,
  type ReconcilePlan,
} from './domain/reconcile.ts'
import { readCards } from './domain/reads.ts'
import { isUsableSlot } from './domain/slots.ts'
import { createApiLink, type ApiLink } from './link.ts'

type DoorEventReport = z.infer<typeof doorEventReport>

/**
 * The six log letters that carry half a tag each. readCards turns them into
 * card-presented events, so reporting them raw as well would say the same thing
 * twice in a form nobody can read.
 */
const TAG_HALVES = new Set(['G', 'g', 'D', 'd', 'R', 'r'])

export interface LoopDependencies {
  controller: DoorAdapter
  link: ApiLink
  /** Slots this process has written or seen the database claim. Lives for the process. */
  ownedSlots: Set<number>
}

/**
 * One reconcile pass. Fetch the card table, read the controller's, write the
 * difference. Running it again against the same state writes nothing, which is
 * what makes it safe on a timer.
 */
export async function runReconcilePass(deps: LoopDependencies): Promise<ReconcilePlan> {
  const table = await deps.link.fetchCardTable()

  // Ownership comes from the database rather than from what this process
  // remembers writing. The set used to start empty at boot, so a card revoked
  // while the service was down stayed on the controller with nothing that would
  // ever remove it, and the fob went on opening the door.
  for (const slot of table.ownedSlots) {
    if (isUsableSlot(slot)) deps.ownedSlots.add(slot)
  }
  for (const card of table.cards) {
    if (isUsableSlot(card.slot)) deps.ownedSlots.add(card.slot)
  }

  const plan = planReconcile({
    databaseCards: table.cards,
    controllerCards: await deps.controller.readCardTable(),
    ownedSlots: deps.ownedSlots,
  })

  await applyPlan(deps, plan)
  return plan
}

async function applyPlan(deps: LoopDependencies, plan: ReconcilePlan): Promise<void> {
  for (const card of plan.writes) {
    await deps.controller.writeCard(card.slot, card.permissions, card.cardNumber)
    deps.ownedSlots.add(card.slot)
  }
  for (const slot of plan.clears) {
    await deps.controller.clearCard(slot)
    deps.ownedSlots.delete(slot)
  }
}

/**
 * Post the status and drain the event log. The log is cleared only after the
 * API has taken the events, so a link that drops loses nothing.
 */
export async function runReportPass(
  deps: LoopDependencies,
  extraEvents: readonly DoorEventReport[],
): Promise<void> {
  const status = await deps.controller.status()
  const entries = await deps.controller.readLog()
  const at = new Date().toISOString()

  // A tag is logged as two entries and neither half is a card number on its
  // own, so the halves are turned into one card-presented event and the raw
  // pair is dropped. Everything else, a lock, a login, an alarm, passes through
  // as it came off the device.
  const events = [
    ...extraEvents,
    ...readCards(entries).map((read) =>
      doorEventReport.parse({ kind: CARD_PRESENTED, at, detail: read }),
    ),
    ...entries
      .filter((entry) => !TAG_HALVES.has(entry.key))
      .map((entry) => doorEventReport.parse({ kind: 'controller-log', at, detail: entry })),
  ]

  await deps.link.postReport({ status, events })
  if (entries.length > 0) await deps.controller.clearLog()
}

/** Commands the API queued while this service was between passes. */
export async function runQueuedCommands(
  deps: LoopDependencies,
): Promise<{ refusals: string[]; syncRequested: boolean }> {
  const refusals: string[] = []
  const pending = await deps.link.fetchCommands()

  for (const command of pending.commands) {
    const refusal = await runDoorCommand(deps.controller, command)
    if (refusal !== null) refusals.push(`${command}: ${refusal}`)
  }

  return { refusals, syncRequested: pending.syncRequested }
}

export async function runPass(deps: LoopDependencies): Promise<void> {
  // Commands are drained first so a sync an admin asked for during the last
  // interval is honoured by this pass rather than the next one. The reconcile
  // runs either way: it is idempotent, and a card table that heals itself on a
  // timer is worth more than one that waits to be told.
  const { syncRequested } = await runQueuedCommands(deps)
  const plan = await runReconcilePass(deps)

  const at = new Date().toISOString()
  const events = [
    ...reportableEvents(plan, at),
    ...(syncRequested ? [doorEventReport.parse({ kind: 'card-table-synced', at })] : []),
  ]

  await runReportPass(deps, events)
  if (!planIsEmpty(plan)) {
    console.log(`door: wrote ${plan.writes.length} cards, cleared ${plan.clears.length}`)
  }
}

export function startLoop(deps: LoopDependencies, intervalSeconds: number): NodeJS.Timeout {
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await runPass(deps)
    } catch (error) {
      // The link being down is the designed failure: cards already on the
      // controller keep opening the door, so this logs and waits.
      console.error(`door: pass failed, will try again. ${describe(error)}`)
    } finally {
      running = false
    }
  }

  void tick()
  return setInterval(() => void tick(), intervalSeconds * 1000)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const config = loadConfig()
  const controller = createArduinoController({
    password: config.controllerPassword,
    transport: createHttpTransport(config.controllerUrl),
  })
  const app = createApp({ controller, doorToken: config.doorToken })

  serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' })
  console.log(`door: listening on 127.0.0.1:${config.port}, controller at ${config.controllerUrl}`)

  const link = createApiLink({ apiUrl: config.apiUrl, doorToken: config.doorToken })
  startLoop({ controller, link, ownedSlots: new Set<number>() }, config.reconcileIntervalSeconds)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
