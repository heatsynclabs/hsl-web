import { timingSafeEqual } from 'node:crypto'

import type {
  DoorCommand,
  DoorControlResponse,
  DoorStatus,
  DoorStatusResponse,
  SyncResponse,
  ErrorResponse,
  SyncCard,
} from '@hsl/schema'
import {
  cards,
  doorControlRequest,
  doorEvents,
  doorReportRequest,
  doorStatus,
  LAST_USABLE_CARD_SLOT,
  user,
} from '@hsl/schema'
import { and, asc, desc, eq, lte } from 'drizzle-orm'
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

/** The kind that marks a door_events row as a status snapshot rather than an event. */
const STATUS_EVENT_KIND = 'status'

/**
 * Refused by a lab decision recorded as HYH 2018-02-22. The refusal is the
 * application's, not the controller's, so it holds whatever hardware is
 * underneath and however the door service is rewritten.
 */
const REFUSED_COMMAND: DoorCommand = 'unlock-rear'

interface QueuedCommand {
  command: DoorCommand
  queuedAt: string
  actorId: string
}

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
  const rows = await db
    .select()
    .from(doorEvents)
    .where(eq(doorEvents.kind, STATUS_EVENT_KIND))
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
  queue: QueuedCommand[],
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

  const queued: QueuedCommand = { command, queuedAt: new Date().toISOString(), actorId }
  queue.push(queued)

  await recordAudit(deps.db, {
    actorId,
    action: 'door.control',
    targetId: null,
    detail: { command },
  })

  return { status: 202, body: { command, queuedAt: queued.queuedAt } }
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

/** Records one status snapshot and whatever events came with it, in one write. */
async function recordReport(
  db: Database,
  report: z.infer<typeof doorReportRequest>,
): Promise<number> {
  await db.insert(doorEvents).values([
    { kind: STATUS_EVENT_KIND, at: new Date(report.reportedAt), detail: report.status },
    ...report.events.map((event) => ({
      kind: event.kind,
      at: new Date(event.at),
      detail: event.detail ?? null,
    })),
  ])

  return report.events.length
}

/** An admin asking for the card table now. Audited, because it touches the door. */
async function recordSyncRequest(deps: AppDeps, actorId: string): Promise<SyncResponse> {
  await recordAudit(deps.db, { actorId, action: 'door.sync', targetId: null })
  return { queuedAt: new Date().toISOString() }
}

export function doorRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()
  const queue: QueuedCommand[] = []
  // Held in memory beside the queue, and drained the same way. Losing it on a
  // restart costs nothing: the reconcile loop runs on a timer regardless.
  let syncRequested = false

  return routes
    .post('/api/door/control', requireCardAccess, jsonBody(doorControlRequest), async (c) => {
      const { command } = c.req.valid('json')
      const actorId = signedIn(c).id

      if (command === REFUSED_COMMAND) return refuseRearUnlock(deps, c, actorId)

      const result = await queueCommand(deps, queue, actorId, command)
      if (result.status === 503) return refuse(c, 503, result.reason)
      return c.json(result.body, 202)
    })
    .get('/api/door/status', requireMember, async (c) => c.json(await readStatus(deps)))
    .get('/api/door/card-table', doorCredential(deps.config), async (c) => {
      const body: { generatedAt: string; cards: SyncCard[] } = {
        generatedAt: new Date().toISOString(),
        cards: await reconcilableCards(deps.db),
      }
      return c.json(body)
    })
    .post('/api/door/report', doorCredential(deps.config), jsonBody(doorReportRequest), async (c) =>
      c.json({ eventsRecorded: await recordReport(deps.db, c.req.valid('json')) }),
    )
    .post('/api/door/sync', requireAdmin, async (c) => {
      syncRequested = true
      return c.json(await recordSyncRequest(deps, signedIn(c).id), 202)
    })
    .get('/api/door/commands', doorCredential(deps.config), (c) => {
      const drained = queue.splice(0, queue.length)
      const body: DoorCommandQueueResponse = {
        commands: drained.map((entry) => entry.command),
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
async function refuseRearUnlock(deps: AppDeps, c: Context<AppEnv>, actorId: string) {
  await recordAudit(deps.db, {
    actorId,
    action: 'door.control.refused',
    targetId: null,
    detail: { command: REFUSED_COMMAND },
  })

  return refuse(
    c,
    403,
    'Unlocking the rear door remotely is refused by the lab decision of 2018-02-22. The command was not sent. Someone in the building has to open it.',
  )
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
