<template>
  <form class="roles" @submit.prevent="emit('save', changes)">
    <fieldset class="roles__group">
      <legend class="roles__legend">Roles</legend>
      <label v-for="role in ROLES" :key="role.key" class="roles__check">
        <input v-model="draft[role.key]" type="checkbox">
        <span>{{ role.label }}</span>
      </label>
    </fieldset>

    <label class="roles__field">
      <span class="roles__label">Member level</span>
      <select v-model="level" class="roles__input">
        <option v-for="option in LEVELS" :key="String(option)" :value="option">
          {{ option === null ? 'Not recorded' : `${option}, ${memberLevelLabel(option)}` }}
        </option>
      </select>
    </label>

    <label class="roles__field">
      <span class="roles__label">Orientation</span>
      <input v-model="orientationDay" class="roles__input" type="date">
    </label>

    <Note v-if="nothingChanged">Nothing on this form has changed yet.</Note>
    <p v-if="error" class="roles__error" role="alert">{{ error.message }}</p>

    <Button variant="primary" type="submit" :disabled="saving || nothingChanged">
      {{ saving ? 'Saving' : 'Save roles and level' }}
    </Button>
  </form>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { MemberSelf, PatchMemberRequest } from '@hsl/schema'
import { memberLevelLabel } from '@hsl/schema'
import { Button, Note } from '@hsl/ui'
import { computed, reactive, ref, watch } from 'vue'

import { dateInputValue, isoFromDateInput } from '../lib/format.ts'

/**
 * The fields PATCH /api/members/:id accepts, and no others. Card access is on
 * this route too and is deliberately not here: it opens a building, so it gets
 * its own control with its own confirmation.
 */
interface Props {
  member: MemberSelf
  saving: boolean
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ save: [changes: PatchMemberRequest] }>()

const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'instructor', label: 'Instructor' },
  { key: 'accountant', label: 'Accountant' },
] as const

// Every level present in production, plus the null 27 rows carry.
const LEVELS: Array<number | null> = [null, 0, 1, 10, 25, 50, 100]

const draft = reactive({ admin: false, instructor: false, accountant: false })
const level = ref<number | null>(null)
const orientationDay = ref('')

watch(
  () => props.member,
  (member) => {
    draft.admin = member.admin
    draft.instructor = member.instructor
    draft.accountant = member.accountant
    level.value = member.memberLevel
    orientationDay.value = dateInputValue(member.orientation)
  },
  { immediate: true },
)

const orientationIso = computed(() => isoFromDateInput(orientationDay.value))

const changes = computed<PatchMemberRequest>(() => {
  const member = props.member
  const out: PatchMemberRequest = {}

  if (draft.admin !== member.admin) out.admin = draft.admin
  if (draft.instructor !== member.instructor) out.instructor = draft.instructor
  if (draft.accountant !== member.accountant) out.accountant = draft.accountant
  if (level.value !== member.memberLevel) out.memberLevel = level.value
  if (dateInputValue(orientationIso.value) !== dateInputValue(member.orientation)) {
    out.orientation = orientationIso.value
  }

  return out
})

const nothingChanged = computed(() => Object.keys(changes.value).length === 0)
</script>

<style scoped>
.roles__group {
  border: var(--bd);
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
}

.roles__legend,
.roles__label {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.roles__check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap);
  font-size: 14px;
}

.roles__field {
  display: block;
  margin-bottom: var(--space-4);
}

.roles__label {
  display: block;
  margin-bottom: 5px;
}

.roles__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--g-ink);
}

.roles__error {
  margin: 0 0 var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
