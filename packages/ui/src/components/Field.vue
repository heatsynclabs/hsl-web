<template>
  <div class="field">
    <label class="field__label" :for="inputId">{{ label }}</label>
    <input
      :id="inputId"
      v-model="value"
      class="field__input"
      :type="type"
      :autocomplete="autocomplete"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    >
    <p v-if="error" :id="errorId" class="field__error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

interface Props {
  label: string
  type?: 'text' | 'email' | 'password' | 'tel'
  error?: string
  autocomplete?: string
  required?: boolean
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  error: '',
  autocomplete: undefined,
  required: false,
})

const value = defineModel<string>({ default: '' })

const inputId = useId()
const errorId = computed(() => `${inputId}-error`)
</script>

<style scoped>
.field {
  margin-bottom: var(--space-3);
}

.field__label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.field__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 11px 12px;
  font-family: var(--font-body);
  font-size: 16px;  /* below 16px iOS zooms the page on focus */
  color: var(--g-ink);
}

.field__input[aria-invalid='true'] {
  border-color: var(--fault);
}

.field__error {
  margin: var(--space-1) 0 0;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-wide);
  color: var(--ink-err);
}
</style>
