import { testClient } from 'hono/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { Harness } from '../test-support/harness.ts'
import { createHarness, describeDatabase, reportDoorStatus } from '../test-support/harness.ts'
import { deriveSpaceApiState } from './space-api.ts'

/**
 * The lab website and an ESP8266 status LED both read this URL. The keys, their
 * types and the vocabulary of the status string are a contract with things
 * outside this repository.
 */

const locked = {
  frontLocked: true,
  rearLocked: true,
  armed: 255,
  activated: 255,
  alarm2: 1,
  alarm3: 1,
}

describe('the two keys the server adds', () => {
  it('reports both doors open only when both are unlocked', () => {
    expect(deriveSpaceApiState({ ...locked, frontLocked: false, rearLocked: false })).toStrictEqual({
      open: true,
      status: 'doors_open=both',
    })
  })

  /**
   * The Rails version reported doors_open=both whenever either door was open,
   * because the first branch tested "unlocked", which was true for either. That
   * is corrected here: door1 and door2 were already in the vocabulary, and a
   * reader that only looks at "open" sees no change.
   */
  it('reports door1 when only the front door is open', () => {
    expect(deriveSpaceApiState({ ...locked, frontLocked: false })).toStrictEqual({
      open: true,
      status: 'doors_open=door1',
    })
  })

  it('reports door2 when only the rear door is open', () => {
    expect(deriveSpaceApiState({ ...locked, rearLocked: false })).toStrictEqual({
      open: true,
      status: 'doors_open=door2',
    })
  })

  it('reports none when both doors are locked', () => {
    expect(deriveSpaceApiState(locked)).toStrictEqual({ open: false, status: 'doors_open=none' })
  })

  /**
   * DoorLog.show_status read the two newest door_logs rows across both keys and
   * then filtered by key, so one door could come back nil and nil was treated
   * as unlocked. A missing reading published "open". Here a missing reading
   * publishes closed: sending somebody to a locked building is the worse
   * failure of the two.
   */
  it('reports closed when there is no reading at all', () => {
    expect(deriveSpaceApiState(null)).toStrictEqual({ open: false, status: 'doors_open=none' })
  })
})

describeDatabase('GET /space_api.json', () => {
  const harness: Harness = createHarness()
  const client = testClient(harness.app)

  beforeEach(async () => {
    await harness.reset()
  })

  afterAll(async () => {
    await harness.close()
  })

  it('serves the template with open and status written over it', async () => {
    await reportDoorStatus(harness, { frontLocked: false })

    const response = await client['space_api.json'].$get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      api: '0.12',
      space: 'HeatSync Labs',
      open: true,
      status: 'doors_open=door1',
    })
  })

  it('answers with the keys in the shape the LED parses', async () => {
    await reportDoorStatus(harness)

    const body = await (await client['space_api.json'].$get()).json()

    expect(typeof body.open).toBe('boolean')
    expect(typeof body.status).toBe('string')
    expect(body.status.startsWith('doors_open=')).toBe(true)
  })

  it('goes closed rather than stale-open when the door service stops reporting', async () => {
    const staleBy = (harness.config.doorStatusStaleSeconds + 60) * 1000
    await reportDoorStatus(harness, { frontLocked: false }, new Date(Date.now() - staleBy))

    const body = await (await client['space_api.json'].$get()).json()

    expect(body.open).toBe(false)
    expect(body.status).toBe('doors_open=none')
  })

  it('needs no session', async () => {
    const response = await client['space_api.json'].$get()
    expect(response.status).toBe(200)
  })
})
