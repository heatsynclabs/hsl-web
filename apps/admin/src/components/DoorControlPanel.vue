<template>
  <div>
    <div class="door__tiles">
      <StatusTile label="Front door" :value="tiles.front.value" :state="tiles.front.state" />
      <StatusTile label="Rear door" :value="tiles.rear.value" :state="tiles.rear.state" />
    </div>

    <Note class="door__reported">{{ reportLine }}</Note>

    <div class="door__controls">
      <Button
        v-for="control in controls"
        :key="control.command"
        class="door__button"
        :variant="control.command === 'open-front' ? 'primary' : 'secondary'"
        :disabled="!live || busy !== null"
        @click="emit('send', control.command, control.label)"
      >
        {{ busy === control.command ? 'Sending' : control.label }}
      </Button>

      <Button class="door__button" disabled>Unlock rear</Button>
    </div>

    <Note class="door__rear">
      Unlocking the rear door from here is refused by the lab decision of 2018-02-22. The button
      stays on the screen so nobody adds it back by mistake. Somebody in the building opens that
      door.
    </Note>

    <p v-if="failure" class="door__error" role="alert">{{ failure }}</p>
  </div>
</template>

<script setup lang="ts">
import type { DoorCommand, DoorStatusResponse } from '@hsl/schema'
import { Button, Note, StatusTile } from '@hsl/ui'
import { computed } from 'vue'

import { whenText } from '../lib/format.ts'

/**
 * The two doors and the commands an admin can send them. It mirrors the member
 * door screen on purpose: the same tiles, the same refusal to draw a state off
 * an old report, and the same rear door decision.
 */
interface Props {
  door: DoorStatusResponse
  /** The command in flight, so its own button says Sending and the rest wait. */
  busy: DoorCommand | null
  /** What went wrong with the last command, already written as a sentence. */
  failure: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ send: [command: DoorCommand, label: string] }>()

/**
 * A stale report is not a reading. The API refuses a command past the same line,
 * so the controls are disabled rather than left to queue into silence.
 */
const live = computed(() => props.door.status !== null && !props.door.stale)

interface Tile {
  value: string
  state: 'locked' | 'unlocked' | 'unknown'
}

function tileFor(locked: boolean | undefined): Tile {
  if (!live.value || locked === undefined) return { value: 'Unknown', state: 'unknown' }
  return locked ? { value: 'Locked', state: 'locked' } : { value: 'Unlocked', state: 'unlocked' }
}

const tiles = computed(() => ({
  front: tileFor(props.door.status?.frontLocked),
  rear: tileFor(props.door.status?.rearLocked),
}))

const reportLine = computed(() => {
  const reportedAt = props.door.reportedAt
  if (reportedAt === null) {
    return 'The door service has never reported. The controls are off until it does. Physical cards still open the door.'
  }
  if (!live.value) {
    return `The last report was ${whenText(reportedAt)}, which is too old to read as live. The controls are off until the door service reports again. Physical cards still open the door.`
  }
  return `The controller reported ${whenText(reportedAt)}.`
})

/**
 * The firmware reports armed as a number and nothing has confirmed what its
 * values mean, so any non zero reads as armed. The fake board in
 * services/door writes 255 for arm and 0 for disarm, which is the only evidence
 * there is, and the member door screen reads it the same way.
 */
const armed = computed(() => (live.value ? props.door.status?.armed !== 0 : null))

interface Control {
  command: DoorCommand
  label: string
}

const controls = computed<Control[]>(() => {
  const always: Control[] = [
    { command: 'open-front', label: 'Open front' },
    { command: 'unlock-front', label: 'Unlock front' },
    { command: 'lock', label: 'Lock all' },
  ]

  // One toggle rather than an Arm button with nothing to turn it off. With no
  // status there is no state to toggle, so the control is left out entirely.
  if (armed.value === null) return always
  return [
    ...always,
    armed.value ? { command: 'disarm', label: 'Disarm alarm' } : { command: 'arm', label: 'Arm alarm' },
  ]
})
</script>

<style scoped>
.door__tiles {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr 1fr;
  margin-bottom: var(--space-3);
}

.door__reported {
  display: block;
  margin-bottom: var(--space-4);
}

.door__controls {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr 1fr;
}

.door__button {
  width: 100%;
  min-height: 52px;
  font-size: 13px;
}

.door__rear {
  display: block;
  margin-top: var(--space-3);
}

.door__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
