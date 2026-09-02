import { renderToString } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { join, resetJoin } from '../join-flow.ts'
import { createJoinRouter } from '../router.ts'
import DoneView from './DoneView.vue'

function render(): Promise<string> {
  return renderToString(DoneView, {
    global: { plugins: [createJoinRouter(createMemoryHistory())] },
  })
}

beforeEach(() => {
  resetJoin()
})

describe('after the application went through', () => {
  it('names the account the API created', async () => {
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    join.draft.memberLevel = 50

    const html = await render()

    expect(html).toContain('ash.invented@example.org')
  })

  it('says how to pay, who records it, and how a card follows orientation', async () => {
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    join.draft.memberLevel = 50

    const html = await render()

    expect(html).toContain('finances@heatsynclabs.org')
    expect(html).toContain('An admin records the payment')
    expect(html).toContain('Orientation is booked with a person')
    expect(html).toContain('A card is issued after orientation')
  })

  it('names no number of days for door access, because nobody has checked one', async () => {
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    join.draft.memberLevel = 100

    const html = await render()

    expect(html).toContain('board rule')
    expect(html).not.toMatch(/\d+\s+(days|business days|weeks)/)
  })

  it('does not ask a volunteer for money', async () => {
    join.created = { id: 'mbr_new', email: 'ash.invented@example.org' }
    join.draft.memberLevel = 10

    const html = await render()

    expect(html).toContain('No dues to send')
    expect(html).not.toContain('finances@heatsynclabs.org')
  })
})

describe('when nothing was sent', () => {
  it('says it has nothing rather than inventing an account', async () => {
    const html = await render()

    expect(html).toContain('No account was created')
    expect(html).toContain('Start at step one')
    expect(html).not.toContain('finances@heatsynclabs.org')
  })
})
