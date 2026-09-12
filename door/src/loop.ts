import type { DoorAdapter } from './adapter.ts'
import type { Command, Link } from './link.ts'

/**
 * One tick. Five seconds apart, with the slow work on a counter.
 *
 * Commands come first because somebody is standing at the door. Cards are
 * fetched only when the version changes, so an idle lab is one small request
 * every five seconds and nothing else. There is no sync endpoint: an admin
 * change changes the version and the next tick picks it up, where the legacy
 * system had an upload-all button an admin had to remember to press.
 */

export interface Memo {
  cardsVersion: string | null
  ticks: number
}

/** State is reported every sixth tick, or immediately after a command. */
const STATE_EVERY = 6

export function memo(): Memo {
  return { cardsVersion: null, ticks: 0 }
}

export async function tick(link: Link, adapter: DoorAdapter, mem: Memo): Promise<void> {
  // 1. Commands first.
  const { commands, cardsVersion } = await link.claimCommands()
  for (const command of commands) await runCommand(link, adapter, command)

  // 2. Events. Cheap, and enrolling a card depends on them arriving promptly.
  await link.postEvents(await adapter.drainEvents())

  // 3. Cards, only when the list actually changed.
  if (cardsVersion !== mem.cardsVersion) {
    const { version, cards } = await link.fetchCards()
    const result = await adapter.uploadCards(cards)
    await link.postPlacements(result)
    await link.postEvents(result.faults)
    mem.cardsVersion = version
  }

  // 4. State.
  if (commands.length > 0 || mem.ticks % STATE_EVERY === 0) {
    await link.postState(await adapter.state(), adapter.capabilities())
  }
  mem.ticks += 1
}

async function runCommand(link: Link, adapter: DoorAdapter, command: Command): Promise<void> {
  try {
    await run(adapter, command)
    await link.commandResult(command.id, 'done')
  } catch (error) {
    await link.commandResult(command.id, 'failed', { message: String(error) })
  }
}

async function run(adapter: DoorAdapter, command: Command): Promise<void> {
  const door = command.door ?? 'all'

  switch (command.action) {
    case 'open':
      return adapter.open(door === 'all' ? '' : door)
    case 'lock':
      return adapter.setLock(door, true)
    case 'unlock':
      return adapter.setLock(door, false)
    case 'alarm.arm':
    case 'alarm.disarm':
      // The API refuses an alarm command against a controller that did not
      // declare the capability, so reaching here means this one did.
      if (adapter.setAlarm === undefined) {
        throw new Error('This controller declared an alarm and does not implement one.')
      }
      return adapter.setAlarm(command.action === 'alarm.arm')
    default:
      throw new Error(`${command.action} is not a command this service knows.`)
  }
}
