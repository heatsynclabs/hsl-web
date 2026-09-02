import { timingSafeEqual } from 'node:crypto'

import type {
  DoorCommand,
  DoorCommandRow,
  DoorControlResponse,
  DoorStatus,
  DoorStatusResponse,
  SyncResponse,
  ErrorResponse,
} from '@hsl/schema'
import {
  cards,
  doorControlRequest,
  doorCommands,
  doorEvents,
  doorReportRequest,
  doorStatus,
  LAST_USABLE_CARD_SLOT,
  REFUSED_DOOR_COMMANDS,
  user,
} from '@hsl/schema'
import { and, asc, desc, eq, isNull, lt, lte } from 'drizzle-orm'
import type { z } from 'zod'
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { Config } from '../config.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireAdmin, requireCardAccess, requireMember, signedIn } from '../middleware/require.ts'
import { jsonBody } from '../middleware/validate.ts'

/**
 * The door, from the API's side. Nothing here speaks the controller's query
 * string protocol: the door service does that, on the lab LAN, and this service
 * never opens a socket to the device.
 *
 * The door service reaches out. It fetches the card table it should reconcile
 * to, drains the commands members queued, and posts status and events back. See
 * decisions/0005-the-door-service-is-outbound-only.md.
 */

/**
 * How far ahead of this server a reported time may be before it is treated as
 * wrong. The door service and the API keep their own clocks and neither is
 * synchronised to the other, so a little drift is ordinary.
 */
const CLOCK_SKEW_SECONDS = 120

/** The kind that marks a door_events row as a status snapshot rather than an event. */
const STATUS_EVENT_KIND = 'status'

/**
 * Refused by a lab decision recorded as HYH 2018-02-22. The refusal is the
 * application's, not the controller's, so it holds whatever hardware is
 * underneath and however the door service is rewritten.
 */


/**
 * How long a waiting command stays worth running.
 *
 * A door command is an immediate intention: somebody is standing at the door.
 * If the door service has not collected it within this window the person has
 * walked away, and running it later unlocks a door with nobody there. Two
 * minutes is two missed passes at the default sixty second interval.
 */
const COMMAND_TTL_SECONDS = 120

/**
 * What the door service gets when it drains the queue: the commands themselves,
 * in the order members asked for them. services/door parses this with
 * z.object({ commands: z.array(doorCommand) }) in its link.ts, and who asked
 * and when is in the audit log rather than here.
 *
 * The shape is declared in both services because @hsl/schema does not carry it
 * yet. It belongs there beside cardTableResponse.
 */
interface DoorCommandQueueResponse {
  commands: DoorCommand[]
  /**
   * True when an admin asked for the card table to be pushed now rather than on
   * the next timed pass. The legacy app called this cards#upload_all and an
   * admin had to remember to run it after every change; here the timer does it
   * anyway and this only shortens the wait.
   */
  syncRequested: boolean
}

export interface LatestDoorStatus {
  status: DoorStatus | null
  reportedAt: Date | null
}

/** The newest status the door service posted, or nulls when it has never posted. */
export async function latestDoorStatus(db: Database): Promise<LatestDoorStatus> {
  // Bounded on both sides. recordReport clamps what it writes, but a row from
  // before that existed, or written straight into the table, would still win on
  // `at desc` forever, and door_events refuses deletes by design so it could not
  // be removed through the application.
  const rows = await db
    .select()
    .from(doorEvents)
    .where(
      and(
        eq(doorEvents.kind, STATUS_EVENT_KIND),
        lte(doorEvents.at, new Date(Date.now() + CLOCK_SKEW_SECONDS * 1000)),
      ),
    )
    .orderBy(desc(doorEvents.at))
    .limit(1)

  const row = rows[0]
  if (row === undefined) return { status: null, reportedAt: null }

  const parsed = doorStatus.safeParse(row.detail)
  return { status: parsed.success ? parsed.data : null, reportedAt: row.at }
}

export function isFresh(reportedAt: Date | null, staleSeconds: number, now: Date): boolean {
  if (reportedAt === null) return false
  return now.getTime() - reportedAt.getTime() <= staleSeconds * 1000
}

/** Waiting commands that have now waited too long to be worth running. */
async function expireStaleCommands(db: Database, now: Date): Promise<DoorCommandRow[]> {
  const cutoff = new Date(now.getTime() - COMMAND_TTL_SECONDS * 1000)

  return db
    .update(doorCommands)
    .set({ resolvedAt: now, resolution: 'expired' })
    .where(and(isNull(doorCommands.resolvedAt), lt(doorCommands.requestedAt, cutoff)))
    .returning()
}

/**
 * Hands the waiting commands to the door service and marks them sent, in one
 * statement so two drains cannot both take the same one.
 */
async function claimCommands(db: Database, now: Date): Promise<DoorCommandRow[]> {
  const claimed = await db
    .update(doorCommands)
    .set({ resolvedAt: now, resolution: 'sent' })
    .where(isNull(doorCommands.resolvedAt))
    .returning()

  return claimed.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())
}

/**
 * Queues one command for the door service to pick up on its next pass.
 *
 * A command is refused rather than queued when the door service has not
 * reported recently, because queueing into silence tells a member the door is
 * about to open when nothing is listening. The building is still reachable with
 * a card, so this is an inconvenience rather than a lockout, and the message
 * says so.
 */
async function queueCommand(
  deps: AppDeps,
  actorId: string,
  command: DoorCommand,
): Promise<{ status: 202; body: DoorControlResponse } | { status: 503; reason: string }> {
  const latest = await latestDoorStatus(deps.db)
  if (!isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, new Date())) {
    return {
      status: 503,
      reason:
        'The door service has not reported recently, so the command was not queued. Physical cards still open the door. Check the door service on the lab host.',
    }
  }

  const [queued] = await deps.db
    .insert(doorCommands)
    .values({ command, requestedById: actorId })
    .returning()

  await recordAudit(deps.db, {
    actorId,
    action: 'door.control',
    targetId: null,
    detail: { command },
  })

  return {
    status: 202,
    body: { command, queuedAt: (queued?.requestedAt ?? new Date()).toISOString() },
  }
}

/** The status a member sees, with whether it is old enough not to trust. */
async function readStatus(deps: AppDeps): Promise<DoorStatusResponse> {
  const latest = await latestDoorStatus(deps.db)

  return {
    status: latest.status,
    reportedAt: latest.reportedAt?.toISOString() ?? null,
    stale: !isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, new Date()),
  }
}

/**
 * A time this server is willing to believe.
 *
 * Without this, one report with a timestamp years ahead wins "the newest
 * status" for as long as it sits in the table, and it is always newer than the
 * staleness window, so the door reads as freshly reported forever and the
 * screens stop being able to say they do not know. That is worse than showing
 * nothing: a member is told the front door is unlocked on the strength of a
 * reading that never happened.
 *
 * A future time is clamped rather than refused, because the reading itself is
 * still the most recent thing the controller said and throwing it away loses
 * real information about a building.
 */
function believableTime(reported: string, now: Date): Date {
  const at = new Date(reported)
  const ceiling = now.getTime() + CLOCK_SKEW_SECONDS * 1000

  return at.getTime() > ceiling ? now : at
}

/** Records one status snapshot and whatever events came with it, in one write. */
async function recordReport(
  db: Database,
  report: z.infer<typeof doorReportRequest>,
): Promise<number> {
  const now = new Date()

  await db.insert(doorEvents).values([
    {
      kind: STATUS_EVENT_KIND,
      at: believableTime(report.reportedAt, now),
      detail: report.status,
    },
    ...report.events.map((event) => ({
      kind: event.kind,
      at: believableTime(event.at, now),
      detail: event.detail ?? null,
    })),
  ])

  return report.events.length
}

/**
 * The commands waiting to run. Anything that waited too long is settled first
 * and recorded, so an admin can see that a command was asked for and never ran
 * rather than finding it silently missing.
 */
async function drainCommands(db: Database): Promise<DoorCommand[]> {
  const now = new Date()

  const expired = await expireStaleCommands(db, now)
  if (expired.length > 0) await recordExpiredCommands(db, expired, now)

  return (await claimCommands(db, now)).map((row) => row.command as DoorCommand)
}

/** What the door service reconciles the controller to, and which slots it owns. */
async function cardTableForService(db: Database) {
  return {
    generatedAt: new Date().toISOString(),
    cards: await reconcilableCards(db),
    ownedSlots: await issuedSlots(db),
  }
}

/** Says in the door history that a command was asked for and never ran. */
async function recordExpiredCommands(
  db: Database,
  expired: DoorCommandRow[],
  at: Date,
): Promise<void> {
  await db.insert(doorEvents).values(
    expired.map((row) => ({
      kind: 'door-command-expired',
      at,
      detail: {
        command: row.command,
        requestedAt: row.requestedAt.toISOString(),
        waitedSeconds: Math.round((at.getTime() - row.requestedAt.getTime()) / 1000),
      },
    })),
  )
}

/** An admin asking for the card table now. Audited, because it touches the door. */
async function recordSyncRequest(deps: AppDeps, actorId: string): Promise<SyncResponse> {
  await recordAudit(deps.db, { actorId, action: 'door.sync', targetId: null })
  return { queuedAt: new Date().toISOString() }
}

export function doorRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()
  // Losing this on a restart costs nothing: the reconcile loop runs on a timer
  // regardless, so a missed sync request only means waiting for the next pass.
  // Commands are different and live in the database.
  let syncRequested = false

  return routes
    .post('/api/door/control', requireCardAccess, jsonBody(doorControlRequest), async (c) => {
      const { command } = c.req.valid('json')
      const actorId = signedIn(c).id

      const refusal = REFUSED_DOOR_COMMANDS[command]
      if (refusal !== undefined) {
        return refuseByLabDecision(deps, c, { actorId, command, reason: refusal })
      }

      const result = await queueCommand(deps, actorId, command)
      if (result.status === 503) return refuse(c, 503, result.reason)
      return c.json(result.body, 202)
    })
    .get('/api/door/status', requireMember, async (c) => c.json(await readStatus(deps)))
    .get('/api/door/card-table', doorCredential(deps.config), async (c) =>
      c.json(await cardTableForService(deps.db)),
    )
    .post('/api/door/report', doorCredential(deps.config), jsonBody(doorReportRequest), async (c) =>
      c.json({ eventsRecorded: await recordReport(deps.db, c.req.valid('json')) }),
    )
    .post('/api/door/sync', requireAdmin, async (c) => {
      syncRequested = true
      return c.json(await recordSyncRequest(deps, signedIn(c).id), 202)
    })
    .get('/api/door/commands', doorCredential(deps.config), async (c) => {
      const body: DoorCommandQueueResponse = {
        commands: await drainCommands(deps.db),
        syncRequested,
      }
      syncRequested = false
      return c.json(body)
    })
}

/**
 * The refusal from 2018-02-22, recorded as well as returned: an attempt to
 * unlock the rear door remotely is worth seeing on the audit screen.
 */
async function refuseByLabDecision(
  deps: AppDeps,
  c: Context<AppEnv>,
  refused: { actorId: string; command: DoorCommand; reason: string },
) {
  await recordAudit(deps.db, {
    actorId: refused.actorId,
    action: 'door.control.refused',
    targetId: null,
    detail: { command: refused.command },
  })

  return refuse(c, 403, refused.reason)
}

/**
 * The card table the controller should hold: active cards belonging to members
 * who have card access, in slots the reader can actually scan.
 *
 * Slot 200 is left out. addUser accepts it, checkUser never reads it, and on an
 * ATmega328 its five bytes wrap onto the alarm state at EEPROM offsets 0 and 1.
 *
 * Card access is a column on the member here. Rails derived it the other way
 * round, from holding a card with permission 1, so a card whose member has lost
 * access stays in the database and stops being written to the device.
 */
/**
 * Every slot this system has issued a card for, active or not. A revoked card
 * leaves reconcilableCards but stays here, which is what lets the door service
 * clear it off the controller instead of reporting it and leaving it working.
 */
async function issuedSlots(db: Database): Promise<number[]> {
  const rows = await db.select({ slot: cards.id }).from(cards).orderBy(asc(cards.id))
  return rows.map((row) => row.slot)
}

async function reconcilableCards(db: Database) {
  return db
    .select({
      slot: cards.id,
      cardNumber: cards.cardNumber,
      permissions: cards.permissions,
    })
    .from(cards)
    .innerJoin(user, eq(user.id, cards.userId))
    .where(
      and(
        eq(cards.active, true),
        eq(user.cardAccess, true),
        lte(cards.id, LAST_USABLE_CARD_SLOT),
      ),
    )
    .orderBy(asc(cards.id))
}

/**
 * The door service has no session. It presents one shared credential, which is
 * the only thing these two routes accept.
 */
function doorCredential(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''

    if (!credentialMatches(presented, config.doorToken)) {
      return refuse(
        c,
        401,
        'That is not the door service credential. Nothing was returned. Check DOOR_TOKEN on the lab host.',
      )
    }

    await next()
  }
}

function credentialMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, and a length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

function refuse(c: Context<AppEnv>, status: 401 | 403 | 503, message: string) {
  const body: ErrorResponse = { error: message }
  return c.json(body, status)
}
