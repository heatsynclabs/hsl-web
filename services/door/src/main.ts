import { pathToFileURL } from 'node:url'

import { serve } from '@hono/node-server'
import { doorEventReport } from '@hsl/schema'
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
import { isUsableSlot } from './domain/slots.ts'
import { createApiLink, type ApiLink } from './link.ts'

type DoorEventReport = z.infer<typeof doorEventReport>

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
  const events = [
    ...extraEvents,
    ...entries.map((entry) => doorEventReport.parse({ kind: 'controller-log', at, detail: entry })),
  ]

  await deps.link.postReport({ status, events })
  if (entries.length > 0) await deps.controller.clearLog()
}

/** Commands the API queued while this service was between passes. */
export async function runQueuedCommands(deps: LoopDependencies): Promise<string[]> {
  const refusals: string[] = []
  for (const command of await deps.link.fetchCommands()) {
    const refusal = await runDoorCommand(deps.controller, command)
    if (refusal !== null) refusals.push(`${command}: ${refusal}`)
  }
  return refusals
}

export async function runPass(deps: LoopDependencies): Promise<void> {
  const plan = await runReconcilePass(deps)
  await runQueuedCommands(deps)
  await runReportPass(deps, reportableEvents(plan, new Date().toISOString()))
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
