import { renderToString } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { join, resetJoin } from '../join-flow.ts'
import { createJoinRouter } from '../router.ts'
import WaiverView from './WaiverView.vue'

function render(): Promise<string> {
  return renderToString(WaiverView, {
    global: { plugins: [createJoinRouter(createMemoryHistory())] },
  })
}

/** The attributes of the button carrying this text, so a test can read them. */
function buttonSaying(html: string, text: string): string {
  const each = html.split('<button').slice(1)
  const mine = each.find((part) => {
    const closes = part.indexOf('</button>')
    return closes !== -1 && part.slice(0, closes).includes(text)
  })
  return mine === undefined ? '' : mine.slice(0, mine.indexOf('>'))
}

beforeEach(() => {
  resetJoin()
})

describe('the waiver step', () => {
  it('leaves the box unticked and the button off until a person ticks it', async () => {
    const html = await render()

    expect(html).not.toContain('checked')
    expect(buttonSaying(html, 'Continue')).toContain('disabled')
    expect(html).toContain('Continue turns on when the box is ticked.')
  })

  it('turns the button on once the box is ticked', async () => {
    join.draft.waiverAccepted = true

    const html = await render()

    expect(buttonSaying(html, 'Continue')).not.toContain('disabled')
  })

  it('says plainly that it is not the signed release itself', async () => {
    const html = await render()

    expect(html).toContain('This screen is not the signed instrument')
    expect(html).toContain('records that you accepted the release')
  })
})
