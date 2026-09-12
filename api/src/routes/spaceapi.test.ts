import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, beforeEach, describe, test } from 'node:test'

import { sql } from '../db.ts'
import { app } from '../index.ts'
import { call, reset, stop } from '../test-support.ts'

async function reported(front: string, rear: string, ago = 0): Promise<void> {
  const at = new Date(Date.now() - ago * 1000).toISOString()
  for (const [door, state] of [
    ['front', front],
    ['rear', rear],
  ]) {
    await sql`
      insert into door_state (controller_id, door, state, reported_at)
      values ('openaccess', ${door as string}, ${state as string}, ${at})
      on conflict (controller_id, door) do update
        set state = excluded.state, reported_at = excluded.reported_at`
  }
}

async function document(): Promise<Record<string, unknown>> {
  return (await (await call(app, '/space_api.json')).json()) as Record<string, unknown>
}

describe('space_api.json', () => {
  beforeEach(reset)
  after(stop)

  test('every key of the template comes out unchanged', async () => {
    const template = JSON.parse(
      await readFile(new URL('../../space_api.template.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>

    const served = await document()
    for (const [key, value] of Object.entries(template)) {
      assert.deepEqual(served[key], value, `the template's ${key} did not survive`)
    }
  })

  test('a door standing unlocked reads as open', async () => {
    await reported('unlocked', 'locked')
    const served = await document()

    assert.equal(served.open, true)
    // SpaceApiController#index reports both whenever either door is open. It is
    // copied rather than corrected, because the LED firmware and the website
    // were written against what this actually emits.
    assert.equal(served.status, 'doors_open=both')
  })

  test('both doors locked reads as closed', async () => {
    await reported('locked', 'locked')
    const served = await document()

    assert.equal(served.open, false)
    assert.equal(served.status, 'doors_open=none')
  })

  test('a reading nobody has refreshed reads as closed rather than as open', async () => {
    await reported('unlocked', 'unlocked', 3600)
    const served = await document()

    assert.equal(served.open, false)
    assert.equal(served.status, 'doors_open=none')
    // And lastchange stops moving, so a reader can tell a stale answer from a
    // fresh one. The legacy document held the last reading forever and called
    // the space open until somebody noticed.
    assert.ok((served.lastchange as number) > 0)
  })

  test('a controller that has never reported reads as closed', async () => {
    const served = await document()
    assert.equal(served.open, false)
    assert.equal(served.lastchange, 0)
  })
})
