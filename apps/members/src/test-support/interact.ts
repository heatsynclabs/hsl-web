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

/**
 * Finding a control the way a person does, by the words on it. A suite that
 * clicks a class name passes when the label changes to something nobody
 * understands, which is the wrong way round.
 */
function named(wrapper: VueWrapper, label: string) {
  const buttons = wrapper.findAll('button')
  const found = buttons.find((button) => button.text() === label)
  if (found === undefined) {
    const offered = buttons.map((button) => `"${button.text()}"`).join(', ')
    throw new Error(`No button says "${label}". This screen offers: ${offered || 'none'}.`)
  }

  return found
}

/**
 * Clicks the button with these words on it. A disabled button is clicked and
 * does nothing, which is what a person gets and what a refusal test asserts on.
 */
export async function click(wrapper: VueWrapper, label: string): Promise<void> {
  await named(wrapper, label).trigger('click')
}

export function isDisabled(wrapper: VueWrapper, label: string): boolean {
  return named(wrapper, label).attributes('disabled') !== undefined
}

export function buttonLabels(wrapper: VueWrapper): string[] {
  return wrapper.findAll('button').map((button) => button.text())
}
