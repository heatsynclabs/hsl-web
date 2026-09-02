<template>
  <Card eyebrow="Door" title="Enrol a card">
    <LoadState :pending="queuePending" :error="queueError" @retry="reloadEnrolment">
      <UnknownCardQueue
        :cards="queue.cards"
        :stale="queue.stale"
        :disabled="assigning"
        @pick="pick"
      />

      <CardAssignForm
        v-if="picked !== null"
        :card-number="picked"
        :members="members"
        :saving="assigning"
        :error="assignError"
        @assign="assign"
        @cancel="picked = null"
      />

      <Note v-if="assigned" class="door-screen__assigned">
        Card {{ assigned.cardNumber }} went to slot {{ slotText(assigned.slot) }} for
        {{ assigned.memberName }}.
        <template v-if="assigned.memberHasCardAccess">
          The card table is pushed on the next pass, so the card opens the front door within
          about a minute rather than the moment you pressed the button.
        </template>
        <template v-else>
          It will not open the door yet: {{ assigned.memberName }} does not have card access, so
          the card is never written to the controller. Turn card access on for them in the
          directory, and the next pass writes it.
        </template>
      </Note>
    </LoadState>
  </Card>

  <div class="door-screen__grid">
    <Card eyebrow="Controller" title="Card table">
      <LoadState :pending="tablePending" :error="tableError" @retry="loadTable">
        <CardTablePanel
          :view="cardTable"
          :busy-slot="busySlot"
          :error="deactivateError"
          @deactivate="deactivate"
        />
      </LoadState>
    </Card>

    <Card eyebrow="Controller" title="Sync now">
      <DoorSyncPanel :saving="syncing" :queued-at="queuedAt" :error="syncError" @sync="sync" />
    </Card>

    <Card eyebrow="Door" title="Status and controls">
      <LoadState :pending="doorPending" :error="doorError" @retry="loadDoor">
        <DoorControlPanel :door="door" :busy="sending" :failure="controlFailure" @send="send" />
      </LoadState>
    </Card>

    <Card eyebrow="Recent" title="Door activity">
      <LoadState :pending="activityPending" :error="activityError" @retry="loadActivity">
        <DoorEventList :events="activity.events" />
      </LoadState>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type {
  CardTableViewResponse,
  DoorCommand,
  DoorEventsResponse,
  DoorStatusResponse,
  MemberDirectoryEntry,
  PostCardRequest,
  UnknownCardsResponse,
} from '@hsl/schema'
import { Card, Note } from '@hsl/ui'
import { onMounted, onUnmounted, ref } from 'vue'

import { api } from '../api.ts'
import CardAssignForm from '../components/CardAssignForm.vue'
import CardTablePanel from '../components/CardTablePanel.vue'
import DoorControlPanel from '../components/DoorControlPanel.vue'
import DoorEventList from '../components/DoorEventList.vue'
import DoorSyncPanel from '../components/DoorSyncPanel.vue'
import LoadState from '../components/LoadState.vue'
import UnknownCardQueue from '../components/UnknownCardQueue.vue'
import { slotText } from '../lib/format.ts'
import { apiPanel } from '../lib/panel.ts'

/**
 * The door, from an admin's side. Enrolling a card used to be five manual steps
 * ending in an upload an admin had to remember; here the service reconstructs
 * the tag, the queue below is where it lands, and the card table is pushed on a
 * timer. This screen fetches, and the components under it take props.
 */

/**
 * The door service runs a pass every sixty seconds by default, so asking four
 * times inside that window keeps the queue and the tiles from lagging a whole
 * pass behind the reader.
 */
const POLL_MS = 15_000

const {
  data: queue,
  pending: queuePending,
  error: queueError,
  load: loadQueue,
  refresh: refreshQueue,
} = apiPanel<UnknownCardsResponse>(() => api.unknownCards(), { cards: [], stale: false })

const { data: members, load: loadMembers } = apiPanel<MemberDirectoryEntry[]>(
  async () => (await api.members()).members,
  [],
)

const {
  data: cardTable,
  pending: tablePending,
  error: tableError,
  load: loadTable,
  refresh: refreshTable,
} = apiPanel<CardTableViewResponse>(() => api.cardTable(), {
  slots: [],
  usedSlots: 0,
  freeSlots: 0,
  nextFreeSlot: null,
})

const {
  data: door,
  pending: doorPending,
  error: doorError,
  load: loadDoor,
  refresh: refreshDoor,
} = apiPanel<DoorStatusResponse>(() => api.doorStatus(), {
  status: null,
  reportedAt: null,
  stale: true,
})

const {
  data: activity,
  pending: activityPending,
  error: activityError,
  load: loadActivity,
  refresh: refreshActivity,
} = apiPanel<DoorEventsResponse>(() => api.doorEvents(), { events: [] })

const picked = ref<string | null>(null)
const assigning = ref(false)
const assignError = ref<ApiError | null>(null)
const assigned = ref<{
  cardNumber: string
  slot: number
  memberName: string
  memberHasCardAccess: boolean
} | null>(null)

const busySlot = ref<number | null>(null)
const deactivateError = ref<ApiError | null>(null)

const syncing = ref(false)
const queuedAt = ref<string | null>(null)
const syncError = ref<ApiError | null>(null)

const sending = ref<DoorCommand | null>(null)
const controlFailure = ref('')

/** The queue and the directory the picker chooses from are both read again. */
function reloadEnrolment(): void {
  void loadQueue()
  void loadMembers()
}

function pick(cardNumber: string): void {
  picked.value = cardNumber
  assignError.value = null
  assigned.value = null
}

/** The directory leaves out members who hide themselves, so an id is the honest fallback. */
function nameOf(userId: string): string {
  return members.value.find((member) => member.id === userId)?.name ?? userId
}

async function assign(request: PostCardRequest): Promise<void> {
  assigning.value = true
  assignError.value = null

  try {
    const answer = await api.assignCard(request)
    assigned.value = {
      cardNumber: answer.card.cardNumber,
      slot: answer.card.slot,
      memberName: nameOf(request.userId),
      memberHasCardAccess: answer.memberHasCardAccess,
    }
    picked.value = null
    await Promise.all([refreshQueue(), refreshTable()])
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    assignError.value = thrown
  } finally {
    assigning.value = false
  }
}

async function deactivate(slot: number): Promise<void> {
  busySlot.value = slot
  deactivateError.value = null

  try {
    await api.updateCard(slot, { active: false })
    await refreshTable()
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    deactivateError.value = thrown
  } finally {
    busySlot.value = null
  }
}

async function sync(): Promise<void> {
  syncing.value = true
  syncError.value = null

  try {
    queuedAt.value = (await api.syncDoor()).queuedAt
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    syncError.value = thrown
  } finally {
    syncing.value = false
  }
}

async function send(command: DoorCommand, label: string): Promise<void> {
  sending.value = command
  controlFailure.value = ''

  try {
    await api.controlDoor({ command })
    await refreshDoor()
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    controlFailure.value = `${label} was refused. ${thrown.problem ?? thrown.message}`
  } finally {
    sending.value = null
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  reloadEnrolment()
  void loadTable()
  void loadDoor()
  void loadActivity()

  timer = setInterval(() => {
    void refreshQueue()
    void refreshDoor()
    void refreshActivity()
  }, POLL_MS)
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<style scoped>
.door-screen__assigned {
  display: block;
  margin-top: var(--space-4);
  border-left: 3px solid var(--hazard);
  padding-left: var(--space-3);
}

.door-screen__grid {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

@media (min-width: 900px) {
  .door-screen__grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
