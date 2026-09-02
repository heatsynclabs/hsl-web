import type { VueWrapper } from '@vue/test-utils'

/**
 * Mount options that put the component in the real document.
 *
 * jsdom runs a form's submission behaviour only for a button inside a document,
 * and @vue/test-utils mounts into a detached node by default. Without this a
 * click on a submit button does nothing and the test passes for the wrong
 * reason. test-support/setup.ts unmounts after every test.
 */
export const attached = { attachTo: document.body } as const

/** Clicks the button with these words on it, the way a person picks one. */
export async function click(wrapper: VueWrapper, label: string): Promise<void> {
  const buttons = wrapper.findAll('button')
  const found = buttons.find((button) => button.text() === label)
  if (found === undefined) {
    const offered = buttons.map((button) => `"${button.text()}"`).join(', ')
    throw new Error(`No button says "${label}". This screen offers: ${offered || 'none'}.`)
  }

  await found.trigger('click')
}
