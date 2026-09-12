import type { DoorAdapter, DoorEvent } from './adapter.ts'
import type { Command, Link, LinkFailure } from './link.ts'

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
  /**
   * Events the API has not accepted yet.
   *
   * The controller's log is a ring that has to be read and then emptied, so by
   * the time a post fails the entries are already gone from the board. Holding
   * them here is the difference between a link outage costing nothing and it
   * costing every card read that happened during it, which is the one thing
   * enrolment depends on.
   */
  undelivered: DoorEvent[]
}

/**
 * How many held events are worth keeping. The board's log is forty entries and
 * a tick drains it, so this is about two hours of a continuously busy door. Past
 * it the oldest go, because a process that grows without limit takes the lab
 * host down and then the door status with it.
 */
const HELD_EVENT_LIMIT = 1000

/** State is reported every sixth tick, or immediately after a command. */
const STATE_EVERY = 6

export function memo(): Memo {
  return { cardsVersion: null, ticks: 0, undelivered: [] }
}

export async function tick(link: Link, adapter: DoorAdapter, mem: Memo): Promise<void> {
  // 1. Commands first.
  const { commands, cardsVersion } = await link.claimCommands()
  for (const command of commands) await runCommand(link, adapter, command)

  // 2. Events. Cheap, and enrolling a card depends on them arriving promptly.
  await deliver(link, mem, await adapter.drainEvents())

  // 3. Cards, only when the list actually changed.
  if (cardsVersion !== mem.cardsVersion) {
    const { version, cards } = await link.fetchCards()
    const result = await adapter.uploadCards(cards)
    await link.postPlacements(result)
    await deliver(link, mem, result.faults)
    mem.cardsVersion = version
  }

  // 4. State.
  if (commands.length > 0 || mem.ticks % STATE_EVERY === 0) {
    await link.postState(await adapter.state(), adapter.capabilities())
  }
  mem.ticks += 1
}

/**
 * Hand the API everything that has not reached it yet, oldest first. Nothing
 * leaves the memo until the API has taken it.
 */
async function deliver(link: Link, mem: Memo, events: readonly DoorEvent[]): Promise<void> {
  mem.undelivered.push(...events)
  if (mem.undelivered.length > HELD_EVENT_LIMIT) {
    mem.undelivered = mem.undelivered.slice(-HELD_EVENT_LIMIT)
  }
  if (mem.undelivered.length === 0) return

  try {
    await link.postEvents(mem.undelivered)
    mem.undelivered = []
  } catch (error) {
    // A refusal is the API saying it will never take these. Holding them would
    // offer the same batch every five seconds forever and keep every later card
    // read behind it. Anything else is the link being down, and those wait.
    const status = (error as LinkFailure).status ?? 0
    if (status >= 400 && status < 500) {
      process.stdout.write(
        `${JSON.stringify({
          at: new Date().toISOString(),
          evt: 'events_dropped',
          count: mem.undelivered.length,
          status,
        })}\n`,
      )
      mem.undelivered = []
    }
    throw error
  }
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
      // The API refuses an open with no door named, so this is a command that
      // did not come from it.
      if (command.door === null) throw new Error('An open has to name a door.')
      return adapter.open(command.door)
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
