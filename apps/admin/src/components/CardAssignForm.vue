<template>
  <div class="assign">
    <p class="assign__which">
      Assigning card <span class="assign__number">{{ cardNumber }}</span>.
    </p>

    <div v-if="members.length === 0">
      <Note>
        The member directory did not load, so there is nobody to pick. Reload this page, then
        choose Assign on the card again.
      </Note>
      <Button @click="emit('cancel')">Cancel</Button>
    </div>

    <form v-else-if="!asking" @submit.prevent="asking = true">
      <Field v-model="search" label="Search name or email" autocomplete="off" />

      <label class="assign__field">
        <span class="assign__label">Member</span>
        <select v-model="userId" class="assign__input">
          <option value="">Pick a member</option>
          <option v-for="option in shown" :key="option.id" :value="option.id">
            {{ option.name }}
          </option>
        </select>
      </label>
      <Note v-if="matches.length > shown.length">
        {{ matches.length }} members match. The list shows the first {{ shown.length }}, so type
        more of the name.
      </Note>

      <Field v-model="label" label="Label, optional" autocomplete="off" />

      <ButtonRow>
        <Button variant="primary" type="submit" :disabled="userId === ''">Review</Button>
        <Button @click="emit('cancel')">Cancel</Button>
      </ButtonRow>
    </form>

    <div v-else class="assign__confirm" role="group" :aria-label="question">
      <p class="assign__question">{{ question }}</p>
      <ButtonRow>
        <Button variant="primary" :disabled="saving" @click="confirm">
          {{ saving ? 'Assigning' : 'Yes, assign it' }}
        </Button>
        <Button :disabled="saving" @click="asking = false">Back</Button>
      </ButtonRow>
    </div>

    <p v-if="error" class="assign__error" role="alert">{{ refusalText }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { MemberDirectoryEntry, PostCardRequest } from '@hsl/schema'
import { Button, ButtonRow, Field, Note } from '@hsl/ui'
import { computed, ref } from 'vue'

import { matchesQuery } from '../lib/directory.ts'
import { assignRefusalText } from '../lib/door.ts'

/**
 * Choosing who an unknown card belongs to. It takes a slot on a physical
 * controller and gives somebody a way into the building, so it is asked twice:
 * the form picks the member, and the question names them before anything is
 * sent.
 */
interface Props {
  cardNumber: string
  members: MemberDirectoryEntry[]
  saving: boolean
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ assign: [request: PostCardRequest]; cancel: [] }>()

// A thousand names in one select is unusable, so the list is the search result.
const SHOWN_AT_ONCE = 50

const search = ref('')
const userId = ref('')
const label = ref('')
const asking = ref(false)

// The same search the directory runs, over name and email both, so an admin
// who found somebody on that screen finds them the same way here.
const matches = computed(() =>
  props.members.filter((member) => matchesQuery(member, search.value)),
)

const shown = computed(() => matches.value.slice(0, SHOWN_AT_ONCE))

const chosenName = computed(
  () => props.members.find((member) => member.id === userId.value)?.name ?? 'that member',
)

const question = computed(
  () =>
    `Give card ${props.cardNumber} to ${chosenName.value}? It takes a slot on the controller and opens the front door once the card table is pushed.`,
)

const refusalText = computed(() => (props.error === null ? '' : assignRefusalText(props.error)))

function confirm(): void {
  const trimmed = label.value.trim()
  const request: PostCardRequest = { userId: userId.value, cardNumber: props.cardNumber }
  emit('assign', trimmed === '' ? request : { ...request, label: trimmed })
}
</script>

<style scoped>
.assign {
  margin-top: var(--space-4);
  border: var(--bd-2);
  border-left: 6px solid var(--hazard);
  background: var(--g-raised);
  padding: var(--space-4);
}

.assign__which {
  margin: 0 0 var(--space-3);
  font-size: 15px;
  color: var(--g-ink);
}

.assign__number {
  font-family: var(--font-mono);
}

.assign__field {
  display: block;
  margin-bottom: var(--space-3);
}

.assign__label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.assign__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--g-ink);
}

.assign__question {
  margin: 0 0 var(--space-3);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: var(--leading-normal);
}

.assign__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
