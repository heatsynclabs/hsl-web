import type { ApiError } from '@hsl/api-client'
import type { CardTableEntry, DoorEventEntry } from '@hsl/schema'
import { LAST_USABLE_CARD_SLOT } from '@hsl/schema'
import type { PillState } from '@hsl/ui'

import { slotText } from './format.ts'

/**
 * Reading what the door reported. The enrolment queue, the card table and the
 * event log arrive as records a machine wrote, and this is where they become
 * the sentences an admin acts on.
 */

/** What the reader did with the card. The values are cardReadOutcome in @hsl/schema. */
export function outcomeText(outcome: unknown): string {
  if (outcome === 'granted') return 'Opened the door'
  if (outcome === 'denied') return 'Refused'
  if (outcome === 'presented') return 'Read, no decision logged'
  return 'The reader logged no outcome'
}

/**
 * Amber for a card the controller let in, because a card no card row claims
 * should not be opening a door. A refusal is the ordinary answer to an unissued
 * card, so it stays plain and nothing on the screen shouts about it.
 */
export function outcomePill(outcome: unknown): PillState {
  if (outcome === 'granted') return 'on'
  return outcome === 'presented' ? 'dim' : 'plain'
}

/**
 * The firmware writes slot 200 and never reads it: its read loop stops at EEPROM
 * offset 1019, which is slot 199. Production holds one card up there. See the
 * "Slot 200 is writable and unreadable" section of docs/legacy-system.md.
 */
export function slotIsReadable(slot: number): boolean {
  return slot <= LAST_USABLE_CARD_SLOT
}

export function unreadableSlots(slots: CardTableEntry[]): number[] {
  return slots.filter((entry) => !slotIsReadable(entry.slot)).map((entry) => entry.slot)
}

export function unreconciledSlots(slots: CardTableEntry[]): number[] {
  return slots.filter((entry) => !entry.reconciled).map((entry) => entry.slot)
}

/** A list of slot numbers as an admin reads them, padded the way the lab writes them. */
export function slotListText(slots: number[]): string {
  return slots.map(slotText).join(', ')
}

type Detail = Record<string, unknown>

function textOf(detail: Detail, key: string): string | null {
  const value = detail[key]
  return typeof value === 'string' ? value : null
}

function countOf(detail: Detail, key: string): string {
  const value = detail[key]
  return typeof value === 'number' ? String(value) : 'an unrecorded number of'
}

function slotOf(detail: Detail): string {
  const value = detail['slot']
  return typeof value === 'number' ? slotText(value) : 'an unrecorded slot'
}

function cardPresentedText(detail: Detail): string {
  const number = textOf(detail, 'cardNumber') ?? 'a number the log did not carry'
  return `Card ${number} was held to a reader. ${outcomeText(detail['outcome'])}.`
}

function controllerLogText(detail: Detail): string {
  const parts = [textOf(detail, 'key'), textOf(detail, 'value')].filter((part) => part !== null)
  if (parts.length === 0) return 'The controller logged a line with nothing in it.'
  return `The controller logged ${parts.join(' ')}.`
}

function slotRefusedText(detail: Detail): string {
  const reason = textOf(detail, 'reason') ?? 'no reason was recorded'
  return `Slot ${slotOf(detail)} was refused: ${reason}.`
}

function reconciledText(detail: Detail): string {
  const written = countOf(detail, 'written')
  return `The card table pass wrote ${written} cards and cleared ${countOf(detail, 'cleared')}.`
}

function strayCardText(detail: Detail): string {
  return `The controller holds a card at slot ${slotOf(detail)} that no card row claims.`
}

function valueText(value: unknown): string {
  if (value === null) return 'none'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function pairsText(detail: Detail): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key} ${valueText(value)}`)
    .join(', ')
}

const DESCRIBERS: Record<string, (detail: Detail) => string> = {
  'card-presented': cardPresentedText,
  'controller-log': controllerLogText,
  'card-slot-refused': slotRefusedText,
  'card-table-reconciled': reconciledText,
  'card-on-controller-not-in-database': strayCardText,
  status: () => 'The door service posted the state it read off the controller.',
  'card-table-synced': () => 'The card table was pushed because an admin asked for it.',
}

/**
 * The door service and the API both write event kinds without asking anything
 * here, so a kind this screen has never seen prints its name and whatever came
 * with it rather than an empty row.
 */
export function eventText(event: DoorEventEntry): string {
  const detail = event.detail ?? {}
  const describe = DESCRIBERS[event.kind]
  if (describe !== undefined) return describe(detail)

  const pairs = pairsText(detail)
  return pairs === '' ? event.kind : `${event.kind}: ${pairs}`
}

/**
 * The API's refusals already say what happened and what to do, so this passes
 * them through rather than rewriting them here. Matching on their wording to
 * add advice would break the moment somebody improved a sentence, and the API
 * is the only place that knows why it refused.
 */
export function assignRefusalText(error: ApiError): string {
  return error.problem ?? error.message
}
