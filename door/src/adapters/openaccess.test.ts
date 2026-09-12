import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Card } from '../adapter.ts'
import { createFakeDevice, fakeAdapter, serveFakeDevice } from './fake.ts'
import {
  createOpenAccess,
  httpTransport,
  isWriteAccepted,
  padTag,
  parseCardTable,
  parseLog,
  parseStatus,
  placementForLegacyCard,
  planUpload,
  redact,
  slotRefusal,
  type Placement,
} from './openaccess.ts'

const PASSWORD = '1234'
const DOORS: [string, string] = ['front', 'rear']

function card(id: string, token: string, placement: unknown = null): Card {
  return { id, token, doors: ['front', 'rear'], placement }
}

function adapter(cards: Placement[] = [], printsTags = true) {
  const device = createFakeDevice({ password: PASSWORD, cards, printsTags })
  return { device, door: fakeAdapter(device, PASSWORD, DOORS) }
}

const writes = (device: { requests: string[] }): string[] =>
  device.requests.filter((query) => query.startsWith('?m'))
const clears = (device: { requests: string[] }): string[] =>
  device.requests.filter((query) => query.startsWith('?r'))

describe('the wire', () => {
  test('a card id reaches the controller as eight uppercase hex characters', () => {
    assert.equal(padTag('4b1c7'), '0004B1C7')
    assert.equal(padTag('0004b1c7'), '0004B1C7')
    // Padding differently is a different tag on the device, so a value that
    // cannot be padded is refused rather than truncated.
    assert.throws(() => padTag('0004B1C7F'))
    assert.throws(() => padTag('not hex'))
  })

  test('a write to slot 200 answers cur and is still a refusal', () => {
    const accepted = '<pre>\r\nprev:\r\n37\t1\t0004B1C7\r\ncur:\r\n37\t1\t0004B1C8\r\n</pre>\r\n'
    const slot200 = '<pre>\r\nprev:\r\nBad user number!\r\ncur:\r\nBad user number!\r\n</pre>\r\n'

    assert.equal(isWriteAccepted(accepted), true)
    assert.equal(isWriteAccepted(slot200), false, 'the substring on its own reported success')
  })

  test('slot 200 is refused with a reason somebody can act on', () => {
    assert.equal(slotRefusal(37), null)
    assert.equal(slotRefusal(199), null)
    assert.match(slotRefusal(200) as string, /never read by checkUser/)
    assert.match(slotRefusal(201) as string, /past the end/)
  })

  test('the card table is read past the header, and empty slots are not cards', () => {
    const body = [
      'authok',
      '<pre>',
      'UserNum: Usermask: TagNum:',
      '0\t255\tFFFFFFFF',
      '37\t1\t4B1C7',
      '38\t255\t0',
      '</pre>',
    ].join('\r\n')

    const { rows, readable } = parseCardTable(body)
    assert.equal(readable, true)
    assert.deepEqual(rows, [{ slot: 37, mask: 1, tag: '0004B1C7' }])
  })

  test('a board that prints asterisks is unreadable rather than empty', () => {
    const body = ['authok', '<pre>', 'UserNum: Usermask: TagNum:', '0\t255\t********', '</pre>'].join('\r\n')

    const { rows, readable } = parseCardTable(body)
    assert.equal(readable, false, 'an unreadable board was taken for an empty one')
    assert.deepEqual(rows, [])
  })

  test('the status document is found after the authok the login printed', () => {
    const body = 'authok\r\n{\r\n"armed":255,"activated":255\r\n,"door_1_locked":1\r\n,"door_2_locked":0\r\n}\r\n'
    const status = parseStatus(body)

    assert.equal(status?.door_1_locked, 1)
    assert.equal(status?.door_2_locked, 0)
    assert.equal(parseStatus('authok\r\n'), null)
  })

  test('a tag is put back together from the two halves the log splits it into', () => {
    // 0x0004B1C7 is 307655. 307655 = 9 * 32767 + 12752.
    const body = ['<pre>', 'D: 12752', 'd: 9', '\0: 0', '</pre>'].join('\r\n')
    assert.deepEqual(parseLog(body), [{ tag: '0004B1C7', outcome: 'denied' }])
  })

  test('half a tag is not a card, and is skipped rather than guessed', () => {
    assert.deepEqual(parseLog(['<pre>', 'D: 12752', 'G: 5', '</pre>'].join('\r\n')), [])
  })

  test('the password never reaches a message', () => {
    assert.equal(redact('?m037&p001&t0004B1C7&e=1234'), '?m037&p001&t0004B1C7&e=REDACTED')
  })
})

describe('the plan', () => {
  test('a card keeps the slot its placement names', () => {
    const plan = planUpload([card('a', '0004B1C7', { slot: 37, mask: 1, tag: '0004B1C7' })], [])
    assert.deepEqual(plan.writes[0]?.placement, { slot: 37, mask: 1, tag: '0004B1C7' })
  })

  test('a card at slot 200 is moved below the limit and the move is a fault', () => {
    const plan = planUpload([card('a', '0004B1C7', { slot: 200, mask: 1, tag: '0004B1C7' })], [])

    assert.equal(plan.writes[0]?.placement.slot, 0)
    assert.match(plan.faults[0]?.detail?.reason as string, /slot 200/)
  })

  test('an empty card list never means clear the building', () => {
    const held = [
      { slot: 1, mask: 1, tag: '00000001' },
      { slot: 2, mask: 1, tag: '00000002' },
    ]
    const plan = planUpload([], held)

    assert.deepEqual(plan.clears, [])
    assert.deepEqual(plan.withheld, [1, 2])
    assert.match(plan.faults[0]?.detail?.reason as string, /nothing was cleared/)
  })

  test('a mass clear is refused even when the list is not empty', () => {
    const held = Array.from({ length: 20 }, (_, slot) => ({ slot, mask: 1, tag: `0000000${slot}`.slice(-8) }))
    const plan = planUpload([card('a', '00000001', held[1] as Placement)], held)

    assert.deepEqual(plan.clears, [])
    assert.equal(plan.withheld.length, 19)
  })

  test('a handful of clears goes through, which is how a revoked card leaves', () => {
    const held = [
      { slot: 1, mask: 1, tag: '00000001' },
      { slot: 2, mask: 1, tag: '00000002' },
    ]
    const plan = planUpload([card('a', '00000001', held[0] as Placement)], held)

    assert.deepEqual(plan.clears, [2])
    assert.deepEqual(plan.writes, [])
  })
})

describe('the adapter, against a board that answers the real bytes', () => {
  test('a pass writes the cards, and running it again writes nothing', async () => {
    const { device, door } = adapter()
    const cards = [card('a', '0004B1C7'), card('b', '0004B1C8')]

    const first = await door.uploadCards(cards)
    assert.equal(first.placements.length, 2)
    assert.equal(writes(device).length, 2)
    assert.equal(first.faults.length, 0)

    const placed = cards.map((one, index) => ({
      ...one,
      placement: first.placements[index]?.placement,
    }))
    const second = await door.uploadCards(placed)

    assert.equal(writes(device).length, 2, 'the second pass wrote again')
    assert.equal(clears(device).length, 0)
    assert.equal(second.faults.length, 0)
  })

  test('the card that legacy left at slot 200 starts working after one pass', async () => {
    const { device, door } = adapter()
    const seeded = placementForLegacyCard(200, '4B1C7', 1)

    const result = await door.uploadCards([card('a', '0004B1C7', seeded)])

    assert.equal((result.placements[0]?.placement as Placement).slot < 200, true)
    assert.match(result.faults[0]?.detail?.reason as string, /slot 200/)
    assert.equal(device.cards.get(200), undefined)
  })

  test('a board that will not print its table is not treated as an empty one', async () => {
    const { device, door } = adapter([], false)
    const placement = { slot: 37, mask: 1, tag: '0004B1C7' }

    const result = await door.uploadCards([card('a', '0004B1C7', placement)])
    assert.equal(writes(device).length, 0, 'it rewrote a card it had no reason to think was missing')

    // And it says why, once, rather than silently.
    assert.match(result.faults[0]?.detail?.reason as string, /will not print its card table/)

    // Once. The next pass is quiet, so the fault is a change and not a drip.
    const again = await door.uploadCards([card('a', '0004B1C7', placement)])
    assert.deepEqual(again.faults, [])
  })

  test('an unissued card held to the reader arrives as something to enrol', async () => {
    const { device, door } = adapter()
    await door.uploadCards([card('a', '0004B1C7')])

    device.present('0004B1C7')
    device.present('0000FFFF')
    const events = await door.drainEvents()

    assert.deepEqual(
      events.map((event) => [event.kind, event.token]),
      [
        ['denied', '0004B1C7'],
        ['presented', '0000FFFF'],
      ],
    )

    // The log is a ring that has to be emptied, or the next pass reports it all
    // over again.
    assert.deepEqual(await door.drainEvents(), [])
  })

  test('the doors answer, and the right strike fires', async () => {
    const { device, door } = adapter()

    assert.deepEqual(await door.state(), { front: 'locked', rear: 'locked' })

    await door.open('front')
    assert.deepEqual(device.pulses, [1])
    await door.open('rear')
    assert.deepEqual(device.pulses, [1, 2])

    await door.setLock('front', false)
    assert.deepEqual(await door.state(), { front: 'unlocked', rear: 'locked' })

    await door.setLock('all', true)
    assert.deepEqual(await door.state(), { front: 'locked', rear: 'locked' })
  })

  test('the alarm is declared and answers', async () => {
    const { device, door } = adapter()
    assert.deepEqual(door.capabilities(), ['open', 'lock', 'unlock', 'alarm'])

    await door.setAlarm?.(true)
    assert.equal(device.armed, 1)
    await door.setAlarm?.(false)
    assert.equal(device.armed, 0)
  })

  test('the whole codec works over a real socket', async () => {
    const device = createFakeDevice({ password: PASSWORD })
    const server = serveFakeDevice(device, 0)
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    const door = createOpenAccess({
      password: PASSWORD,
      transport: httpTransport(`http://127.0.0.1:${port}`),
      doors: DOORS,
    })

    const result = await door.uploadCards([card('a', '0004B1C7')])
    assert.equal(result.placements.length, 1)
    assert.deepEqual(await door.fetchCards(), [
      { token: '0004B1C7', placement: { slot: 0, mask: 1, tag: '0004B1C7' }, claimed: false },
    ])
    assert.deepEqual(await door.state(), { front: 'locked', rear: 'locked' })

    server.close()
  })

  test('a wrong password is a refusal that says so', async () => {
    const device = createFakeDevice({ password: '1234' })
    const door = fakeAdapter(device, '9999', DOORS)

    const result = await door.uploadCards([card('a', '0004B1C7')])
    assert.equal(result.placements.length, 0)
    assert.equal(result.removed.length, 1)
    assert.ok(
      result.faults.some((event) => String(event.detail?.said ?? '').includes('authfail')),
      'nothing in the faults says the board refused the login',
    )
  })
})

describe('defects found in audit', () => {
  test('a card id that is not hex is refused on its own, not by wedging the pass', async () => {
    const { device, door } = adapter()

    // The API stores a card id as text with no format rule at all, on purpose:
    // rule Two says the hardware format is the adapter's business. So an admin
    // can type anything into POST /api/credentials, and the adapter meets it.
    const result = await door.uploadCards([card('a', 'not a card'), card('b', '0004B1C7')])

    assert.equal(writes(device).length, 1, 'the good card was not written')
    assert.deepEqual(
      result.placements.map((placement) => placement.cardId),
      ['b'],
    )
    assert.match(result.faults[0]?.detail?.reason as string, /not one to eight hex characters/)
    assert.deepEqual(result.removed, ['a'])
  })

  test('a door event names the card id the API issued, not the padded one', async () => {
    const { device, door } = adapter()

    // The API stores a card id as text and has no format rule, so an admin can
    // issue one as five hex characters. The device is written eight. If the
    // event came back in the device's form it would match no credential row,
    // and the member who opened the door would not be on their own door log.
    await door.uploadCards([card('a', '4b1c7')])
    device.present('0004B1C7', 'granted')

    const events = await door.drainEvents()
    assert.deepEqual(
      events.map((event) => [event.kind, event.token]),
      [['entry', '4b1c7']],
    )
  })

  test('a card the API never issued arrives in the form the reader saw it', async () => {
    const { device, door } = adapter()
    await door.uploadCards([card('a', '4b1c7')])
    device.present('0000FFFF')

    const events = await door.drainEvents()
    assert.deepEqual(
      events.map((event) => [event.kind, event.token]),
      [['presented', '0000FFFF']],
    )
  })

  test('the whole pass survives a card id the controller cannot hold', async () => {
    const { door } = adapter()
    await door.uploadCards([card('a', 'nonsense')])

    // And the next pass is still quiet, rather than retrying the impossible.
    const second = await door.uploadCards([card('a', 'nonsense')])
    assert.equal(second.placements.length, 0)
  })
})
