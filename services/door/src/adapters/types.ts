import type { Door, DoorController, DoorLogEntry, DoorStatus } from '@hsl/schema'

import type { CardTableRow } from '../domain/reconcile.ts'

export type { Door, DoorController, DoorLogEntry, DoorStatus }

/**
 * The DoorController from @hsl/schema plus the three calls the reconcile loop
 * needs and the API never sees: reading the card table back, reading one slot,
 * and clearing the event log after the API has accepted it.
 *
 * Policy stays above this interface. An adapter does what it is told and the
 * refusals live in app.ts, so they hold whatever hardware is underneath.
 */
export interface DoorAdapter extends DoorController {
  readCardTable(): Promise<CardTableRow[]>
  readCard(slot: number): Promise<CardTableRow | null>
  clearLog(): Promise<void>
}

/**
 * Sends one query string, leading question mark included, and returns the
 * response body. Every controller response is HTTP 200 and errors arrive as
 * plain strings in the body, so there is nothing else to hand back.
 */
export type ControllerTransport = (query: string) => Promise<string>
