import { ApiError } from '@hsl/api-client'
import { renderToString } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CardAccessControl from './CardAccessControl.vue'

const base = { memberName: 'Sam Rivera', saving: false, error: null }

describe('CardAccessControl', () => {
  it('says whether card access is on, and does not ask the question until asked', async () => {
    const html = await renderToString(CardAccessControl, {
      props: { ...base, cardAccess: false },
    })

    expect(html).toContain('Turn card access on')
    // The confirmation is a second step on purpose. One click must not open a door.
    expect(html).not.toContain('Yes, do it')
  })

  it('offers to take access away from a member who has it', async () => {
    const html = await renderToString(CardAccessControl, { props: { ...base, cardAccess: true } })

    expect(html).toContain('Turn card access off')
  })

  it('shows the refusal the API gave rather than a blank control', async () => {
    const refused = ApiError.refused({
      method: 'PATCH',
      path: '/api/members/mbr_rivera',
      status: 403,
      body: { error: 'That needs an admin. Nothing was changed. Ask an admin to make the change.' },
    })

    const html = await renderToString(CardAccessControl, {
      props: { ...base, cardAccess: false, error: refused },
    })

    expect(html).toContain('That needs an admin.')
  })
})
