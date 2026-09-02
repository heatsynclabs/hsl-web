<template>
  <div class="door-controls">
    <Button
      v-for="control in controls"
      :key="control.command"
      class="door-controls__button"
      :variant="control.command === 'open-front' ? 'primary' : 'secondary'"
      :disabled="disabled || busy !== null"
      @click="emit('send', control.command, control.label)"
    >
      {{ busy === control.command ? 'Sending' : control.label }}
    </Button>

    <Button class="door-controls__button" disabled>Unlock rear</Button>
    <Note class="door-controls__reason">
      Unlocking the rear door from here is refused by the lab decision of 2018-02-22. The button
      stays on the screen so nobody adds it back by mistake. Somebody in the building opens that
      door.
    </Note>
  </div>
</template>

<script setup lang="ts">
import type { DoorCommand } from '@hsl/schema'
import { Button, Note } from '@hsl/ui'
import { computed } from 'vue'

interface Props {
  /** Null when the controller has not reported, so the alarm has no paired state. */
  armed: boolean | null
  /** The command in flight, so its own button says Sending and the rest wait. */
  busy: DoorCommand | null
  disabled: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ send: [command: DoorCommand, label: string] }>()

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
  if (props.armed === null) return always
  return [...always, props.armed
    ? { command: 'disarm', label: 'Disarm alarm' }
    : { command: 'arm', label: 'Arm alarm' }]
})
</script>

<style scoped>
/* Phone first: one control per row, thumb sized. */
.door-controls {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.door-controls__button {
  width: 100%;
  min-height: 52px;
  font-size: 13px;
}

.door-controls__reason {
  margin-top: calc(var(--space-1) * -1);
}

@media (min-width: 600px) {
  .door-controls {
    grid-template-columns: 1fr 1fr;
  }

  .door-controls__reason {
    grid-column: 1 / -1;
    margin-top: 0;
  }
}
</style>
