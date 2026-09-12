/**
 * The whole of what a controller has to implement. Seven methods.
 *
 * Everything a device is like lives below this line: slot numbers, permission
 * masks, tag padding, wire framing, login sequencing, blocking commands, ring
 * buffers, and builds that will not report their own contents. Nothing above
 * this line knows any of it.
 */

export type Capability = 'open' | 'lock' | 'unlock' | 'alarm'

export type DoorState = 'locked' | 'unlocked' | 'unknown'

/** A card the API says this controller should be holding. */
export interface Card {
  id: string
  token: string
  doors: string[]
  /** Where this card sits on this controller, as this adapter last wrote it. */
  placement: unknown | null
}

/** A card the device is holding now. */
export interface HeldCard {
  token: string | null
  placement: unknown
  claimed: boolean
}

export type EventKind = 'entry' | 'denied' | 'presented' | 'alarm' | 'fault' | 'command'

export interface DoorEvent {
  kind: EventKind
  at: string
  token?: string | null
  door?: string | null
  detail?: Record<string, unknown>
}

export interface UploadResult {
  placements: Array<{ cardId: string; placement: unknown }>
  /** Credential ids whose placement is now void. */
  removed: string[]
  /** Could not place, found something unclaimed, refused. */
  faults: DoorEvent[]
}

export interface DoorAdapter {
  /** What this controller can do. Drives what the API will accept. */
  capabilities(): Capability[]

  /** What the device holds now. Empty when the device cannot be read back. */
  fetchCards(): Promise<HeldCard[]>

  /**
   * Make the device hold exactly these cards and nothing else this system
   * issued. Declarative, not a delta: work out the difference from the
   * placements handed in, and return placements for whatever was written.
   * Idempotent.
   */
  uploadCards(cards: Card[]): Promise<UploadResult>

  open(door: string): Promise<void>
  setLock(door: string | 'all', locked: boolean): Promise<void>

  state(): Promise<Record<string, DoorState>>
  drainEvents(): Promise<DoorEvent[]>

  /**
   * The one optional method, and the only place this interface is eight rather
   * than seven. A controller with no alarm leaves it out and does not list the
   * alarm capability, and the API refuses `alarm.arm` before it is ever queued,
   * so nothing here implements a method that means nothing to it.
   */
  setAlarm?(armed: boolean): Promise<void>
}

export function now(): string {
  return new Date().toISOString()
}

export function fault(reason: string, detail: Record<string, unknown> = {}): DoorEvent {
  return { kind: 'fault', at: now(), detail: { reason, ...detail } }
}
