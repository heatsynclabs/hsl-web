import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { unknownCards } from '../test-fixtures.ts'
import UnknownCardQueue from './UnknownCardQueue.vue'

const base = { stale: false, disabled: false }

describe('UnknownCardQueue', () => {
  it('renders the cards the door service reported, with what the reader did', async () => {
    const html = await renderToString(UnknownCardQueue, { props: { ...base, cards: unknownCards } })

    expect(html).toContain('0004B1C7')
    expect(html).toContain('Refused')
    expect(html).toContain('00021D40')
    expect(html).toContain('Opened the door')
  })

  it('offers an assign action on every row, and on no other', async () => {
    const html = await renderToString(UnknownCardQueue, { props: { ...base, cards: unknownCards } })

    expect(html.match(/<button/g)?.length).toBe(unknownCards.length)
  })

  it('tells an admin who has never done this what to do first', async () => {
    const html = await renderToString(UnknownCardQueue, { props: { ...base, cards: unknownCards } })

    expect(html).toContain('Hold the card to the reader by the door')
    expect(html).toContain('Choose Assign on its row')
  })

  it('says the queue is empty and how to fill it', async () => {
    const html = await renderToString(UnknownCardQueue, { props: { ...base, cards: [] } })

    expect(html).toContain('No unknown card has been read in the last 24 hours.')
    expect(html).toContain('Hold the card to the reader by the door and it shows up here.')
  })

  it('warns that the list may be behind when the door service has gone quiet', async () => {
    const html = await renderToString(UnknownCardQueue, {
      props: { ...base, stale: true, cards: unknownCards },
    })

    expect(html).toContain('The door service has not reported recently')
    expect(html).toContain('may be behind')
  })

  it('says nothing about staleness when the door service is reporting', async () => {
    const html = await renderToString(UnknownCardQueue, { props: { ...base, cards: unknownCards } })

    expect(html).not.toContain('may be behind')
  })
})
