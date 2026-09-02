<template>
  <section class="door">
    <div class="door__tiles">
      <StatusTile label="Front door" :value="tiles.front.value" :state="tiles.front.state" />
      <StatusTile label="Rear door" :value="tiles.rear.value" :state="tiles.rear.state" />
    </div>

    <Note class="door__reported">{{ reportLine }}</Note>

    <p v-if="failure" class="door__error" role="alert">{{ failure }}</p>

    <DoorControls v-if="cardAccess" :armed="armed" :busy="busy" :disabled="!live" @send="send" />
    <DoorAccessHelp v-else class="door__help" />

    <RecentActions :entries="entries" />
  </section>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type { DoorCommand, DoorStatusResponse } from '@hsl/schema'
import { Note, StatusTile } from '@hsl/ui'
import { computed, onUnmounted, ref } from 'vue'

import DoorAccessHelp from '../components/DoorAccessHelp.vue'
import DoorControls from '../components/DoorControls.vue'
import type { DoorAction } from '../components/RecentActions.vue'
import RecentActions from '../components/RecentActions.vue'
import { useApi } from '../lib/api'
import { formatTimeOfDay } from '../lib/format'
import { useMemberSession } from '../lib/session'

/**
 * The door service posts a status once per reconcile pass, sixty seconds by
 * default in services/door/src/config.ts. Asking four times inside that window
 * keeps the tiles from lagging a whole pass behind a command.
 */
const POLL_MS = 15_000

const api = useApi()
const session = useMemberSession()
const cardAccess = computed(() => session.value.me?.member.cardAccess === true)

const door = ref<DoorStatusResponse | null>(null)
const failure = ref('')
const busy = ref<DoorCommand | null>(null)
const entries = ref<DoorAction[]>([])

await refresh()

// The server renderer draws once and never unmounts, so a timer started there
// would outlive the render with nothing to stop it.
if (typeof window !== 'undefined') {
  const timer = setInterval(() => void refresh(), POLL_MS)
  onUnmounted(() => clearInterval(timer))
}

/** A stale report is not a reading. The API refuses commands past the same line. */
const live = computed(() => door.value !== null && door.value.status !== null && !door.value.stale)

/**
 * The firmware reports armed as a number and nothing has confirmed what its
 * values mean, so this reads any non zero as armed. The fake board in
 * services/door/src/adapters/fake/device.ts writes 255 for arm and 0 for
 * disarm, which is the only evidence there is.
 *
 * ASSUMPTION: the real board also writes zero and only zero for disarmed.
 * CONFIRM BY: sending ?1 then ?9 to the board in the lab.
 * BLAST RADIUS: the toggle would offer to arm an already armed alarm.
 */
const armed = computed(() => (live.value ? door.value?.status?.armed !== 0 : null))

const tiles = computed(() => ({
  front: tileFor(door.value?.status?.frontLocked),
  rear: tileFor(door.value?.status?.rearLocked),
}))

function tileFor(locked: boolean | undefined): { value: string; state: 'locked' | 'unlocked' | 'unknown' } {
  if (!live.value || locked === undefined) return { value: 'Unknown', state: 'unknown' }
  return locked ? { value: 'Locked', state: 'locked' } : { value: 'Unlocked', state: 'unlocked' }
}

const reportLine = computed(() => {
  const reportedAt = door.value?.reportedAt
  if (reportedAt === null || reportedAt === undefined) {
    return 'The door service has never reported. Physical cards still open the door.'
  }
  const at = formatTimeOfDay(reportedAt)
  return live.value
    ? `The controller reported at ${at}.`
    : `The last report was at ${at}, which is too old to read as live. Physical cards still open the door.`
})

async function refresh(): Promise<void> {
  try {
    door.value = await api.doorStatus()
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    door.value = null
    failure.value = error.message
  }
}

async function send(command: DoorCommand, label: string): Promise<void> {
  busy.value = command
  failure.value = ''

  try {
    const queued = await api.controlDoor({ command })
    remember(`${label}, sent`, queued.queuedAt)
    await refresh()
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    failure.value = error.message
    remember(`${label}, refused`, new Date().toISOString())
  } finally {
    busy.value = null
  }
}

function remember(what: string, at: string): void {
  entries.value = [{ what, at }, ...entries.value]
}
</script>

<style scoped>
/* Phone first. Two tiles side by side is the one thing that fits at any width. */
.door__tiles {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr 1fr;
  margin-bottom: var(--space-3);
}

.door__reported {
  margin-bottom: var(--space-4);
}

.door__error {
  margin: 0 0 var(--space-4);
  border: var(--bd-2);
  border-color: var(--fault);
  padding: var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}

.door__help {
  display: block;
  margin-bottom: var(--space-4);
}

@media (min-width: 900px) {
  .door {
    max-width: 720px;
  }
}
</style>
