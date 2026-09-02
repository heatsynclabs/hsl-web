import { ApiError, createClient } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import CardTablePanel from '../components/CardTablePanel.vue'
import DoorEventList from '../components/DoorEventList.vue'
import LoadState from '../components/LoadState.vue'
import UnknownCardQueue from '../components/UnknownCardQueue.vue'
import { cardTableView, doorEventEntries, unknownCards } from '../test-fixtures.ts'
import DoorView from './DoorView.vue'

/**
 * The path the door screen walks: the API answers, the client parses it against
 * the contract, the panels render it. Nothing here is stubbed except the
 * network.
 */

const realFetch = globalThis.fetch

function apiAnswering(body: unknown, status = 200): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('the door screen', () => {
  it('renders the queue GET /api/door/unknown-cards returned', async () => {
    apiAnswering({ cards: unknownCards, stale: false })
    const answer = await createClient({ baseUrl: '' }).unknownCards()

    const html = await renderToString(UnknownCardQueue, {
      props: { cards: answer.cards, stale: answer.stale, disabled: false },
    })

    expect(html).toContain('0004B1C7')
    expect(html).toContain('Refused')
    expect(html).toContain('Assign')
  })

  it('tells an admin to hold the card to the reader when the queue is empty', async () => {
    apiAnswering({ cards: [], stale: false })
    const answer = await createClient({ baseUrl: '' }).unknownCards()

    const html = await renderToString(UnknownCardQueue, {
      props: { cards: answer.cards, stale: answer.stale, disabled: false },
    })

    expect(html).toContain('Hold the card to the reader by the door and it shows up here.')
  })

  it('says the queue may be behind when the door service has gone quiet', async () => {
    apiAnswering({ cards: unknownCards, stale: true })
    const answer = await createClient({ baseUrl: '' }).unknownCards()

    const html = await renderToString(UnknownCardQueue, {
      props: { cards: answer.cards, stale: answer.stale, disabled: false },
    })

    expect(html).toContain('The door service has not reported recently')
  })

  it('renders the card table GET /api/door/card-table-view returned', async () => {
    apiAnswering(cardTableView)
    const answer = await createClient({ baseUrl: '' }).cardTable()

    const html = await renderToString(CardTablePanel, {
      props: { view: answer, busySlot: null, error: null },
    })

    expect(html).toContain('041')
    expect(html).toContain('Sam Rivera')
    expect(html).toContain('Reader cannot see it')
    expect(html).toContain('Will be cleared')
  })

  it('renders the events GET /api/door/events returned as sentences', async () => {
    apiAnswering({ events: doorEventEntries })
    const answer = await createClient({ baseUrl: '' }).doorEvents()

    const html = await renderToString(DoorEventList, { props: { events: answer.events } })

    expect(html).toContain('Card 0004B1C7 was held to a reader. Refused.')
  })

  it('shows a refused queue request as something a person can act on', async () => {
    apiAnswering({ error: 'The door service has not reported recently.' }, 503)

    let refusal: ApiError | null = null
    try {
      await createClient({ baseUrl: '' }).unknownCards()
    } catch (thrown) {
      refusal = thrown as ApiError
    }

    expect(refusal).toBeInstanceOf(ApiError)
    const html = await renderToString(LoadState, {
      props: { pending: false, error: refusal },
      slots: { default: 'the queue' },
    })

    expect(html).toContain('The door service has not reported recently.')
    expect(html).toContain('Physical cards still work.')
    expect(html).not.toContain('the queue')
  })

  it('opens with every panel reading, and with the sync button already honest about itself', async () => {
    const html = await renderToString(DoorView)

    expect(html).toContain('Enrol a card')
    expect(html).toContain('Card table')
    expect(html).toContain('Status and controls')
    expect(html).toContain('Door activity')
    expect(html).toContain('Reading from the API.')
    expect(html).toContain('about once a minute')
    expect(html).toContain('only shortens the wait')
  })
})
