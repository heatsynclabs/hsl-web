import { ApiError, createClient } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DirectoryTable from '../components/DirectoryTable.vue'
import LoadState from '../components/LoadState.vue'
import { toRow } from '../lib/directory.ts'
import { directoryEntries } from '../test-fixtures.ts'

/**
 * The whole path the directory screen walks: the API answers, the client parses
 * it against the contract, the rows are built, the table renders them. Nothing
 * here is stubbed except the network.
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

const global = { stubs: { RouterLink: { template: '<a><slot /></a>' } } }

describe('the directory screen', () => {
  it('renders the members GET /api/members returned', async () => {
    apiAnswering({ members: directoryEntries })
    const answer = await createClient({ baseUrl: '' }).members()

    const html = await renderToString(DirectoryTable, {
      props: {
        rows: answer.members.map((entry) => toRow(entry, new Map())),
        unknownText: 'reading',
        emptyText: 'No member matches that search.',
      },
      global,
    })

    expect(html).toContain('Sam Rivera')
    expect(html).toContain('M. Volkov')
    expect(html).toContain('Associate ($25)')
  })

  it('renders its empty state when the lab has no member to show', async () => {
    apiAnswering({ members: [] })
    const answer = await createClient({ baseUrl: '' }).members()

    const html = await renderToString(DirectoryTable, {
      props: {
        rows: answer.members.map((entry) => toRow(entry, new Map())),
        unknownText: 'reading',
        emptyText: 'No member matches that search.',
      },
      global,
    })

    expect(html).toContain('No member matches that search.')
  })

  it('shows a refused request as something a person can act on, not a blank screen', async () => {
    apiAnswering(
      {
        error:
          'The member directory opens after new member orientation. It was not returned. Ask an admin to record your orientation.',
      },
      403,
    )

    let refusal: ApiError | null = null
    try {
      await createClient({ baseUrl: '' }).members()
    } catch (thrown) {
      refusal = thrown as ApiError
    }

    expect(refusal).toBeInstanceOf(ApiError)
    const html = await renderToString(LoadState, {
      props: { pending: false, error: refusal },
      slots: { default: 'the table' },
    })

    expect(html).toContain('The member directory opens after new member orientation.')
    expect(html).toContain('Ask an admin whether it should be allowed to.')
    expect(html).not.toContain('the table')
  })
})
