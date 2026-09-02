<template>
  <button
    type="button"
    class="theme"
    :aria-label="`Switch to ${otherTheme(theme)} theme`"
    :title="`Switch to ${otherTheme(theme)} theme`"
    @click="toggle"
  >
    <!-- Inline SVG rather than an emoji: an emoji renders differently on every
         platform, carries no accessible name and cannot inherit a token colour. -->
    <svg
      class="theme__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <template v-if="theme === 'light'">
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <path d="M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </g>
      </template>
      <path
        v-else
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
        fill="currentColor"
      />
    </svg>
    <span class="theme__label">{{ theme }}</span>
  </button>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { applyTheme, otherTheme, storedTheme, type Theme } from '../theme'

// Starts on the default so the server-rendered markup and the first paint agree.
// onMounted then reads what this browser chose last time.
const theme = ref<Theme>('light')

onMounted(() => {
  theme.value = storedTheme()
})

function toggle(): void {
  theme.value = otherTheme(theme.value)
  applyTheme(theme.value)
}
</script>

<style scoped>
.theme {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap);
  padding: 0 var(--space-3);
  /* --g-line is a hairline at 16 percent and measures 1.38:1 against the app
     bar, well under the 3:1 a control boundary needs. Every other control in
     the system uses the solid one. */
  border: 2px solid var(--g-line-hi);
  background: transparent;
  color: var(--g-ink-2);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  cursor: pointer;
}

.theme:hover {
  border-color: var(--g-accent);
  color: var(--g-on-accent);
}

.theme__icon {
  flex: none;
}

/* The icon says it on a phone, where the app bar has no room for the word. */
@media (max-width: 560px) {
  .theme__label {
    display: none;
  }
}
</style>
