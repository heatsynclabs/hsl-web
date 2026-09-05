import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

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
 * clicks .access__confirm button:first-child breaks when the markup is
 * rearranged and passes when the label changes to something nobody understands,
 * which is the wrong way round.
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
 * Clicks the button with this label. A disabled button is clicked and does
 * nothing, which is what a person gets and what a refusal test asserts on.
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

/**
 * A label that wraps its control reads as its own words followed by every
 * option in the select, so the words are taken from the span the forms put them
 * in when there is one.
 */
function labelText(label: DOMWrapper<Element>): string {
  const span = label.find('span')
  return span.exists() ? span.text() : label.text()
}

/**
 * The box a person would type in, found by the words above it. Field wires a
 * label to an input with for and id; the plain selects and checkboxes on these
 * forms wrap their control in the label instead, so both shapes are handled.
 */
function control(wrapper: VueWrapper, label: string) {
  const labels = wrapper.findAll('label')
  const found = labels.find((candidate) => labelText(candidate) === label)
  if (found === undefined) {
    const offered = labels.map((candidate) => `"${labelText(candidate)}"`).join(', ')
    throw new Error(`No control is labelled "${label}". This screen offers: ${offered || 'none'}.`)
  }

  const wired = found.attributes('for')
  if (wired !== undefined) return wrapper.get(`#${wired}`)

  const inside = found.find('input, select, textarea')
  if (!inside.exists()) throw new Error(`The label "${label}" has no control in it.`)
  return inside
}

/** Types into, picks from, or ticks the control with this label. */
export async function fill(
  wrapper: VueWrapper,
  label: string,
  value: string | boolean,
): Promise<void> {
  await control(wrapper, label).setValue(value)
}

/** The options a select offers, in the order they are listed. */
export function optionLabels(wrapper: VueWrapper, label: string): string[] {
  return control(wrapper, label)
    .findAll('option')
    .map((option) => option.text())
}

/**
 * Presses a button the way a keyboard does: focus it first, then click.
 *
 * click() on its own never establishes focus, so a suite using it cannot tell
 * whether a screen that swaps the pressed button for something else leaves the
 * keyboard anywhere useful. It does not: the browser drops focus onto the body
 * when the focused element leaves the document, and the next Tab starts at the
 * top of the page.
 */
export async function pressWithKeyboard(wrapper: VueWrapper, label: string): Promise<void> {
  const button = named(wrapper, label)
  ;(button.element as HTMLButtonElement).focus()
  await button.trigger('click')
}

/** Whether the keyboard ended up inside the element matching this selector. */
export function focusIsInside(wrapper: VueWrapper, selector: string): boolean {
  const region = wrapper.find(selector)
  return region.exists() && region.element.contains(document.activeElement)
}

/** What the keyboard is on, for a failure message somebody can read. */
export function focusedText(): string {
  const active = document.activeElement
  if (active === null || active === document.body) return 'the page body, which is nowhere'
  return `${active.tagName.toLowerCase()} "${(active.textContent ?? '').trim().slice(0, 40)}"`
}
