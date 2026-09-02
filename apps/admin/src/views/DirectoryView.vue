<template>
  <Card eyebrow="Members" title="Directory">
    <LoadState :pending="pending" :error="error" @retry="load">
      <div class="dir__controls">
        <label class="dir__field">
          <span class="dir__label">Search name or email</span>
          <input v-model="query" class="dir__input" type="search" placeholder="Rivera">
        </label>
        <label class="dir__field dir__field--narrow">
          <span class="dir__label">Card</span>
          <select v-model="card" class="dir__input">
            <option value="any">Any</option>
            <option value="held">Holds a card</option>
            <option value="none">No card</option>
          </select>
        </label>
      </div>

      <Note>
        {{ matched.length }} of {{ entries.length }} members. Card and dues status live on each
        member's own record, so this screen reads the record for the page you are looking at and
        the card filter covers what it has read. The directory route leaves out members who hide
        themselves.
      </Note>

      <div class="dir__table">
        <DirectoryTable
          :rows="rows"
          :unknown-text="enriching ? 'reading' : 'unavailable'"
          empty-text="No member matches that search."
        />
      </div>

      <div v-if="pages > 1" class="dir__pager">
        <Button :disabled="page <= 1" @click="page -= 1">Previous</Button>
        <span class="dir__count">Page {{ page }} of {{ pages }}</span>
        <Button :disabled="page >= pages" @click="page += 1">Next</Button>
      </div>
    </LoadState>
  </Card>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type { MemberDirectoryEntry } from '@hsl/schema'
import { Button, Card, Note } from '@hsl/ui'
import { computed, onMounted, ref, watch } from 'vue'

import { api } from '../api.ts'
import DirectoryTable from '../components/DirectoryTable.vue'
import LoadState from '../components/LoadState.vue'
import type { CardFilter, MemberSummary } from '../lib/directory.ts'
import { filterMembers, PAGE_SIZE, pageCount, pageOf, summarise, toRow } from '../lib/directory.ts'

const entries = ref<MemberDirectoryEntry[]>([])
const summaries = ref(new Map<string, MemberSummary>())
const pending = ref(true)
const error = ref<ApiError | null>(null)
const enriching = ref(false)

const query = ref('')
const card = ref<CardFilter>('any')
const page = ref(1)

// Asked for once, whether it answered or not: a record that refused must not be
// asked for again on every render.
const asked = new Set<string>()

const matched = computed(() =>
  filterMembers(entries.value, { query: query.value, card: card.value }, summaries.value),
)
const pages = computed(() => pageCount(matched.value.length, PAGE_SIZE))
const shown = computed(() => pageOf(matched.value, page.value, PAGE_SIZE))
const rows = computed(() => shown.value.map((entry) => toRow(entry, summaries.value)))

async function load(): Promise<void> {
  pending.value = true
  error.value = null

  try {
    entries.value = (await api.members()).members
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    error.value = thrown
  } finally {
    pending.value = false
  }
}

/** Six at a time, so opening a page is a burst the API can answer, not a flood. */
const AT_ONCE = 6

async function readRecords(ids: string[]): Promise<void> {
  const queue = ids.filter((id) => !asked.has(id))
  if (queue.length === 0) return

  for (const id of queue) asked.add(id)
  enriching.value = true

  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // One member's record failing leaves that row's two columns unavailable.
      // It must not empty the rest of the directory.
      try {
        summaries.value.set(id, summarise(await api.member(id)))
      } catch (thrown) {
        if (!(thrown instanceof ApiError)) throw thrown
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
  enriching.value = false
}

watch([query, card], () => {
  page.value = 1
})

// A narrowing search can leave the reader standing on a page that no longer
// exists, which would look like an empty directory rather than a short one.
watch(pages, (last) => {
  if (page.value > last) page.value = last
})

watch(shown, (visible) => void readRecords(visible.map((entry) => entry.id)))

onMounted(load)
</script>

<style scoped>
.dir__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.dir__field {
  display: block;
  flex: 1 1 240px;
}

.dir__field--narrow {
  flex: 0 1 180px;
}

.dir__label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.dir__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--g-ink);
}

.dir__table {
  overflow-x: auto;
  margin-top: var(--space-3);
}

.dir__pager {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.dir__count {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-wide);
  color: var(--g-ink-3);
}
</style>
