import { renderToString } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { leaveStep, resetJoin } from '../join-flow.ts'
import { createJoinRouter } from '../router.ts'
import AccountView from './AccountView.vue'

function render(): Promise<string> {
  return renderToString(AccountView, {
    global: { plugins: [createJoinRouter(createMemoryHistory())] },
  })
}

beforeEach(() => {
  resetJoin()
})

describe('the account step', () => {
  it('asks for the four things the account is made from', async () => {
    const html = await render()

    expect(html).toContain('Full name')
    expect(html).toContain('Email')
    expect(html).toContain('Password')
    expect(html).toContain('Phone')
  })

  it('says where it is in the flow', async () => {
    const html = await render()

    expect(html).toContain('Step 1 of 5')
  })

  it('shows nothing red before somebody has tried to continue', async () => {
    const html = await render()

    expect(html).not.toContain('aria-invalid')
  })

  it('puts the reason on the field the schema refused', async () => {
    leaveStep('account')

    const html = await render()

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('Enter the name the lab should have on your record.')
    expect(html).toContain('Choose a password of at least 8 characters.')
  })
})
