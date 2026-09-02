import { readFileSync } from 'node:fs'

import type { DoorStatus, SpaceApiResponse } from '@hsl/schema'
import { Hono } from 'hono'

import type { AppEnv, AppDeps } from '../context.ts'
import { isFresh, latestDoorStatus } from './door.ts'

/**
 * The public status document. The lab website and an ESP8266 status LED both
 * read this URL, so its shape is a contract with things outside this repository.
 *
 * The body is a SpaceAPI 0.12 template the lab edits. Rails kept it in
 * settings.space_api_json_template, parsed it, and added exactly two keys. This
 * does the same: the template is read once at boot and open and status are
 * written over it.
 *
 * Rails derived the two keys like this, from DoorLog.show_status:
 *
 *   @json["open"] = door_status[:unlocked]
 *   if    door_status[:unlocked]       then "doors_open=both"
 *   elsif !door_status[:door_1_locked] then "doors_open=door1"
 *   elsif !door_status[:door_2_locked] then "doors_open=door2"
 *   else                                    "doors_open=none"
 *
 * That carries two defects, and each is decided here rather than copied.
 *
 * The first: show_status read the two newest door_logs rows across both keys
 * and then filtered by key, so when both newest rows shared a key the other
 * door came back nil, and nil was read as unlocked. A missing reading therefore
 * published "open". This service reads one validated status object holding both
 * doors, so the case cannot arise, and when there is no fresh reading at all it
 * publishes closed. A false "open" sends somebody to a locked building.
 *
 * The second: the first branch reported doors_open=both whenever either door
 * was open. That is fixed. both now means both, and one door open reports door1
 * or door2, which are values the vocabulary already had. The keys, their types
 * and the rest of the document are unchanged, so a reader that only looks at
 * "open" sees no difference at all.
 */

/**
 * Used when no template is configured. Deliberately small: the production
 * document is the lab's, and nothing here invents an address, a coordinate or a
 * logo that nobody has checked.
 */
const FALLBACK_TEMPLATE: Record<string, unknown> = {
  api: '0.12',
  space: 'HeatSync Labs',
  url: 'https://heatsynclabs.org',
}

export function deriveSpaceApiState(status: DoorStatus | null): {
  open: boolean
  status: string
} {
  if (status === null) return { open: false, status: 'doors_open=none' }

  const frontOpen = !status.frontLocked
  const rearOpen = !status.rearLocked

  if (frontOpen && rearOpen) return { open: true, status: 'doors_open=both' }
  if (frontOpen) return { open: true, status: 'doors_open=door1' }
  if (rearOpen) return { open: true, status: 'doors_open=door2' }
  return { open: false, status: 'doors_open=none' }
}

export function spaceApiRoutes(deps: AppDeps) {
  const routes = new Hono<AppEnv>()
  const template = loadTemplate(deps.config.spaceApiTemplatePath)

  return routes
    .get('/space_api.json', async (c) => {
      const latest = await latestDoorStatus(deps.db)
      const fresh = isFresh(latest.reportedAt, deps.config.doorStatusStaleSeconds, new Date())

      const body: SpaceApiResponse = {
        ...template,
        ...deriveSpaceApiState(fresh ? latest.status : null),
      }
      return c.json(body)
    })
}

function loadTemplate(path: string | null): Record<string, unknown> {
  if (path === null) return FALLBACK_TEMPLATE

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new Error(
      `SPACE_API_TEMPLATE_PATH names ${path}, which could not be read. The API did not start.`,
      { cause },
    )
  }

  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a JSON object. The API did not start.`)
  }

  return parsed as Record<string, unknown>
}
