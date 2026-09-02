<template>
  <component
    :is="href ? 'a' : 'button'"
    class="btn"
    :class="[`btn--${variant}`, { 'btn--block': block, 'btn--disabled': disabled }]"
    :href="href && !disabled ? href : undefined"
    :type="href ? undefined : type"
    :disabled="href ? undefined : disabled"
    :aria-disabled="disabled ? 'true' : undefined"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary'
  type?: 'button' | 'submit'
  href?: string
  disabled?: boolean
  block?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'secondary',
  type: 'button',
  href: undefined,
  disabled: false,
  block: false,
})
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--tap);
  padding: 0 var(--space-4);
  border: var(--bd-2);
  background: transparent;
  color: var(--g-ink);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast),
    background-color var(--transition-fast);
}

.btn--block {
  width: 100%;
}

.btn--primary {
  background: var(--hazard);
  border-color: var(--tape-dark);
  color: var(--tape-dark);
  box-shadow: var(--shadow-sm);
}

.btn--primary:hover:not(.btn--disabled) {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow);
}

.btn--primary:active:not(.btn--disabled) {
  transform: translate(0, 0);
  box-shadow: var(--shadow-sm);
}

.btn--secondary:hover:not(.btn--disabled) {
  background: var(--hazard-dim);
}

.btn--disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
