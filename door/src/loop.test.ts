import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Card, Capability, DoorEvent, DoorState, UploadResult } from './adapter.ts'
import { createFakeDevice, fakeAdapter } from './adapters/fake.ts'
import type { Command, Link } from './link.ts'
import { memo, tick } from './loop.ts'

/** A link that records what the loop asked it for, in order. */
function stubLink(overrides: Partial<Link> & { cards?: Card[]; version?: string; commands?: Command[] }) {
  const calls: string[] = []
  const results: Array<{ id: string; outcome: string }> = []
  let version = overrides.version ?? 'v1'
  let commands = overrides.commands ?? []

  const link: Link = {
    claimCommands: async () => {
      calls.push('claimCommands')
      const waiting = commands
      commands = []
      return { commands: waiting, cardsVersion: version }
    },
    postEvents: async (events: DoorEvent[]) => {
      if (events.length > 0) calls.push(`postEvents:${events.length}`)
    },
    fetchCards: async () => {
      calls.push('fetchCards')
      return { version, cards: overrides.cards ?? [] }
    },
    postPlacements: async (result: UploadResult) => {
      calls.push(`postPlacements:${result.placements.length}`)
    },
    postState: async (doors: Record<string, DoorState>, capabilities: Capability[]) => {
      calls.push(`postState:${Object.keys(doors).length}:${capabilities.length}`)
    },
    commandResult: async (id: string, outcome: string) => {
      calls.push(`commandResult:${outcome}`)
      results.push({ id, outcome })
    },
  }

  return {
    link,
    calls,
    results,
    setVersion: (next: string) => {
      version = next
    },
    queue: (next: Command[]) => {
      commands = next
    },
  }
}

function adapter() {
  const device = createFakeDevice({ password: '1234' })
  return { device, door: fakeAdapter(device, '1234', ['front', 'rear']) }
}

describe('the loop', () => {
  test('commands come first, because somebody is standing at the door', async () => {
    const { device, door } = adapter()
    const stub = stubLink({ commands: [{ id: 'c1', action: 'open', door: 'front' }] })

    await tick(stub.link, door, memo())

    assert.equal(stub.calls[0], 'claimCommands')
    assert.equal(stub.calls[1], 'commandResult:done')
    assert.deepEqual(device.pulses, [1])
  })

  test('a command the controller refuses comes back as failed rather than silently', async () => {
    const { door } = adapter()
    const stub = stubLink({ commands: [{ id: 'c1', action: 'teleport', door: null }] })

    await tick(stub.link, door, memo())
    assert.deepEqual(stub.results, [{ id: 'c1', outcome: 'failed' }])
  })

  test('the card list is fetched once and not again until the version moves', async () => {
    const { door } = adapter()
    const stub = stubLink({ cards: [{ id: 'a', token: '0004B1C7', doors: ['front'], placement: null }] })
    const mem = memo()

    await tick(stub.link, door, mem)
    assert.equal(stub.calls.filter((call) => call === 'fetchCards').length, 1)

    await tick(stub.link, door, mem)
    await tick(stub.link, door, mem)
    assert.equal(stub.calls.filter((call) => call === 'fetchCards').length, 1, 'an idle lab refetched')

    stub.setVersion('v2')
    await tick(stub.link, door, mem)
    assert.equal(stub.calls.filter((call) => call === 'fetchCards').length, 2)
  })

  test('state goes up on the first tick, after a command, and every sixth', async () => {
    const { door } = adapter()
    const stub = stubLink({})
    const mem = memo()

    for (let pass = 0; pass < 6; pass += 1) await tick(stub.link, door, mem)
    assert.equal(stub.calls.filter((call) => call.startsWith('postState')).length, 1)

    stub.queue([{ id: 'c1', action: 'lock', door: null }])
    await tick(stub.link, door, mem)
    assert.equal(stub.calls.filter((call) => call.startsWith('postState')).length, 2)

    // Both doors, and the four things this controller says it can do.
    assert.equal(stub.calls.find((call) => call.startsWith('postState')), 'postState:2:4')
  })

  test('a card the reader refused is reported before the card list is touched', async () => {
    const { device, door } = adapter()
    const stub = stubLink({})
    device.present('0000FFFF')

    await tick(stub.link, door, memo())

    const events = stub.calls.indexOf('postEvents:1')
    const cards = stub.calls.indexOf('fetchCards')
    assert.ok(events !== -1 && events < cards, 'enrolling a card waits behind the card list')
  })
})
