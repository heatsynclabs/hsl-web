import { timingSafeEqual } from 'node:crypto'

import type {
  DoorCommand,
  DoorControlResponse,
  DoorStatus,
  DoorStatusResponse,
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
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

import { recordAudit } from '../audit.ts'
import type { Config } from '../config.ts'
import type { AppDeps, AppEnv } from '../context.ts'
import type { Database } from '../db.ts'
import { requireCardAccess, requireMember, signedIn } from '../middleware/require.ts'
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

export function doorRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()
  const queue: QueuedCommand[] = []

  return routes
    .post(
      '/api/door/control',
      requireCardAccess,
      jsonBody(doorControlRequest),
      async (c) => {
        const { command } = c.req.valid('json')
        const actorId = signedIn(c).id

        if (command === REFUSED_COMMAND) return refuseRearUnlock(deps, c, actorId)

        const latest = await latestDoorStatus(deps.db)
        if (!isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, new Date())) {
          return refuse(
            c,
            503,
            'The door service has not reported recently, so the command was not queued. Physical cards still open the door. Check the door service on the lab host.',
          )
        }

        const queued: QueuedCommand = { command, queuedAt: new Date().toISOString(), actorId }
        queue.push(queued)

        await recordAudit(deps.db, {
          actorId,
          action: 'door.control',
          targetId: null,
          detail: { command },
        })

        const body: DoorControlResponse = { command, queuedAt: queued.queuedAt }
        return c.json(body, 202)
      },
    )
    .get('/api/door/status', requireMember, async (c) => {
      const latest = await latestDoorStatus(deps.db)

      const body: DoorStatusResponse = {
        status: latest.status,
        reportedAt: latest.reportedAt?.toISOString() ?? null,
        stale: !isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, new Date()),
      }
      return c.json(body)
    })
    .get('/api/door/card-table', doorCredential(deps.config), async (c) => {
      const body: { generatedAt: string; cards: SyncCard[] } = {
        generatedAt: new Date().toISOString(),
        cards: await reconcilableCards(deps.db),
      }
      return c.json(body)
    })
    .post(
      '/api/door/report',
      doorCredential(deps.config),
      jsonBody(doorReportRequest),
      async (c) => {
        const report = c.req.valid('json')

        await deps.db.insert(doorEvents).values([
          {
            kind: STATUS_EVENT_KIND,
            at: new Date(report.reportedAt),
            detail: report.status,
          },
          ...report.events.map((event) => ({
            kind: event.kind,
            at: new Date(event.at),
            detail: event.detail ?? null,
          })),
        ])

        return c.json({ eventsRecorded: report.events.length })
      },
    )
    .get('/api/door/commands', doorCredential(deps.config), (c) => {
      const drained = queue.splice(0, queue.length)
      const body: DoorCommandQueueResponse = { commands: drained.map((entry) => entry.command) }
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
