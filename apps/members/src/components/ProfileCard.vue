<template>
  <Card eyebrow="Profile" :title="member.name">
    <KeyValue :rows="rows" />
    <div class="profile-card__actions">
      <Button type="button" @click="emit('edit')">Edit profile</Button>
    </div>
  </Card>
</template>

<script setup lang="ts">
import type { MemberSelf } from '@hsl/schema'
import type { KeyValueRow } from '@hsl/ui'
import { Button, Card, KeyValue } from '@hsl/ui'
import { computed } from 'vue'

interface Props {
  member: MemberSelf
}

const props = defineProps<Props>()
const emit = defineEmits<{ edit: [] }>()

const NOT_SET = 'Not set'

/**
 * emailVisible and phoneVisible are columns the member owns, so each value
 * carries the pill that says which way it is set rather than leaving a member
 * to guess who can read it.
 */
function visibility(visible: boolean): KeyValueRow['pills'] {
  return visible
    ? [{ text: 'Visible to members', state: 'dim' }]
    : [{ text: 'Hidden', state: 'off' }]
}

function emergency(member: MemberSelf): string {
  const parts = [member.emergencyName, member.emergencyPhone, member.emergencyEmail]
  const given = parts.filter((part): part is string => part !== null && part !== '')
  return given.length === 0 ? NOT_SET : given.join(', ')
}

const rows = computed<KeyValueRow[]>(() => [
  { label: 'Email', value: props.member.email, pills: visibility(props.member.emailVisible) },
  {
    label: 'Phone',
    value: props.member.phone ?? NOT_SET,
    pills: visibility(props.member.phoneVisible),
  },
  { label: 'Postal', value: props.member.postalCode ?? NOT_SET },
  { label: 'Emergency', value: emergency(props.member) },
])
</script>

<style scoped>
.profile-card__actions {
  margin-top: var(--space-3);
}
</style>
