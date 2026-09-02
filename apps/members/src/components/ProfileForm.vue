<template>
  <Card eyebrow="Profile" title="Edit profile">
    <form @submit.prevent="emit('save', toPatch())">
      <Field v-model="draft.name" label="Name" autocomplete="name" required />
      <Field v-model="draft.phone" label="Phone" type="tel" autocomplete="tel" />
      <Field v-model="draft.postalCode" label="Postal code" autocomplete="postal-code" />
      <Field v-model="draft.emergencyName" label="Emergency contact" />
      <Field v-model="draft.emergencyPhone" label="Emergency phone" type="tel" />
      <Field v-model="draft.emergencyEmail" label="Emergency email" type="email" />
      <Field v-model="draft.currentSkills" label="Skills you have" />
      <Field v-model="draft.desiredSkills" label="Skills you want" />

      <fieldset class="profile-form__toggles">
        <legend class="profile-form__legend">Who can see this</legend>
        <label class="profile-form__toggle">
          <input v-model="draft.emailVisible" type="checkbox">
          <span>Show my email to other members</span>
        </label>
        <label class="profile-form__toggle">
          <input v-model="draft.phoneVisible" type="checkbox">
          <span>Show my phone to other members</span>
        </label>
        <label class="profile-form__toggle">
          <input v-model="draft.hidden" type="checkbox">
          <span>Keep me out of the member directory</span>
        </label>
      </fieldset>

      <p v-if="error" class="profile-form__error" role="alert">{{ error }}</p>

      <ButtonRow>
        <Button type="submit" variant="primary" :disabled="saving">
          {{ saving ? 'Saving' : 'Save changes' }}
        </Button>
        <Button type="button" :disabled="saving" @click="emit('cancel')">Cancel</Button>
      </ButtonRow>

      <Note class="profile-form__note">
        Your email address is not on this form. It is how you sign in, so it changes through the
        password and account routes rather than a profile edit. Member level, orientation, waiver
        and the accountant role are set by an admin and are recorded in the audit log.
      </Note>
    </form>
  </Card>
</template>

<script setup lang="ts">
import type { MemberSelf, PatchMeRequest } from '@hsl/schema'
import { Button, ButtonRow, Card, Field, Note } from '@hsl/ui'
import { reactive } from 'vue'

interface Props {
  member: MemberSelf
  saving?: boolean
  error?: string
}

const props = withDefaults(defineProps<Props>(), { saving: false, error: '' })
const emit = defineEmits<{ save: [changes: PatchMeRequest]; cancel: [] }>()

const draft = reactive({
  name: props.member.name,
  phone: props.member.phone ?? '',
  postalCode: props.member.postalCode ?? '',
  emergencyName: props.member.emergencyName ?? '',
  emergencyPhone: props.member.emergencyPhone ?? '',
  emergencyEmail: props.member.emergencyEmail ?? '',
  currentSkills: props.member.currentSkills ?? '',
  desiredSkills: props.member.desiredSkills ?? '',
  emailVisible: props.member.emailVisible,
  phoneVisible: props.member.phoneVisible,
  hidden: props.member.hidden,
})

/** An emptied box means the member cleared the field, which the column stores as null. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toPatch(): PatchMeRequest {
  return {
    name: draft.name.trim(),
    phone: orNull(draft.phone),
    postalCode: orNull(draft.postalCode),
    emergencyName: orNull(draft.emergencyName),
    emergencyPhone: orNull(draft.emergencyPhone),
    emergencyEmail: orNull(draft.emergencyEmail),
    currentSkills: orNull(draft.currentSkills),
    desiredSkills: orNull(draft.desiredSkills),
    emailVisible: draft.emailVisible,
    phoneVisible: draft.phoneVisible,
    hidden: draft.hidden,
  }
}
</script>

<style scoped>
.profile-form__toggles {
  margin: 0 0 var(--space-4);
  border: var(--bd-2);
  padding: var(--space-3) var(--space-4);
}

.profile-form__legend {
  padding: 0 var(--space-2);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.profile-form__toggle {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap);
  font-size: 14px;
  color: var(--g-ink);
}

.profile-form__toggle input {
  width: 20px;
  height: 20px;
  flex: none;
  accent-color: var(--hazard);
}

.profile-form__error {
  margin: 0 0 var(--space-3);
  border: var(--bd-2);
  border-color: var(--fault);
  padding: var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}

.profile-form__note {
  margin-top: var(--space-4);
}
</style>
