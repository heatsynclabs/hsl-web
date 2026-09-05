<template>
  <div class="access" :class="{ 'access--on': cardAccess }">
    <p class="access__state">
      Card access is <strong>{{ cardAccess ? 'on' : 'off' }}</strong> for {{ memberName }}.
    </p>
    <Note>
      Card access is what lets this member open the doors remotely. Turning it on is a building
      key, so it is asked twice.
    </Note>

    <div v-if="!asking" class="access__row">
      <Button ref="trigger" :disabled="saving" @click="asking = true">
        {{ cardAccess ? 'Turn card access off' : 'Turn card access on' }}
      </Button>
    </div>

    <div
      v-else
      ref="confirmation"
      class="access__confirm"
      role="group"
      :aria-label="confirmQuestion"
      tabindex="-1"
    >
      <p class="access__question">{{ confirmQuestion }}</p>
      <ButtonRow>
        <Button variant="primary" :disabled="saving" @click="confirm">
          {{ saving ? 'Saving' : 'Yes, do it' }}
        </Button>
        <Button :disabled="saving" @click="asking = false">Cancel</Button>
      </ButtonRow>
    </div>

    <p v-if="error" class="access__error" role="alert">{{ error.message }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import { Button, ButtonRow, Note } from '@hsl/ui'
import type { ComponentPublicInstance } from 'vue'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

/**
 * The one control on the member screen that opens a building, kept apart from
 * the roles form and asked twice on purpose.
 */
interface Props {
  memberName: string
  cardAccess: boolean
  saving: boolean
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ set: [value: boolean] }>()

const asking = ref(false)
const trigger = useTemplateRef<ComponentPublicInstance>('trigger')
const confirmation = useTemplateRef<HTMLElement>('confirmation')

/**
 * Where the keyboard goes when the question opens and closes.
 *
 * Vue swaps the button that was pressed for the question, and a browser drops
 * focus onto the body when the focused element leaves the document. Without
 * this the next Tab starts at the top of the page, where the first stop is Sign
 * out, and a screen reader is told nothing has happened: the group carries the
 * question as its name, so focusing it is what reads the question aloud.
 */
watch(asking, async (open) => {
  await nextTick()

  if (open) confirmation.value?.focus()
  else (trigger.value?.$el as HTMLElement | undefined)?.focus()
})

const confirmQuestion = computed(() =>
  props.cardAccess
    ? `Take card access away from ${props.memberName}? They stop being able to open the doors remotely.`
    : `Give ${props.memberName} card access? They will be able to open the doors remotely.`,
)

function confirm(): void {
  emit('set', !props.cardAccess)
}

// The answer arrived and the question is stale, so it closes itself.
watch(
  () => props.cardAccess,
  () => {
    asking.value = false
  },
)
</script>

<style scoped>
.access {
  border: var(--bd-2);
  border-left: 6px solid var(--hazard);
  background: var(--g-raised);
  padding: var(--space-4);
  color: var(--g-ink);
}

.access--on {
  background: var(--hazard-dim);
}

.access__state {
  margin: 0 0 var(--space-2);
  font-size: 15px;
}

.access__row,
.access__confirm {
  margin-top: var(--space-3);
}

.access__question {
  margin: 0 0 var(--space-3);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: var(--leading-normal);
}

.access__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
