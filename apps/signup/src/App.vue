<template>
  <div class="join" data-ground="page">
    <AppBar app-name="Join HeatSync Labs">
      <ThemeToggle />
    </AppBar>
    <div class="join__tape" />

    <main class="join__wrap">
      <p v-if="apiUnreachable" class="join__warning">
        The members API did not answer when this page loaded. Fill this in if you like, and the
        last step will tell you whether it can be sent.
      </p>

      <RouterView />
    </main>

    <footer class="join__foot">
      What you enter here goes into the lab's members database. You can change your own details
      later from the members app.
    </footer>
  </div>
</template>

<script setup lang="ts">
import { useSession } from '@hsl/api-client'
import { AppBar, ThemeToggle } from '@hsl/ui'
import { RouterView } from 'vue-router'

// main.ts resolves the session before the app mounts, so this is the settled
// answer. A signed out visitor is the normal case here and is not an error.
const apiUnreachable = useSession().state.error !== null
</script>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--g-bg);
  color: var(--g-ink);
}

.join__tape {
  height: 14px;
  background: repeating-linear-gradient(
    -45deg,
    var(--hazard) 0 22px,
    var(--tape-dark) 22px 44px
  );
}

.join__wrap {
  flex: 1;
  width: 100%;
  max-width: var(--container-lg);
  margin-inline: auto;
  padding: var(--space-8) max(var(--space-4), var(--safe-l)) var(--space-16);
}

.join__warning {
  margin: 0 0 var(--space-6);
  border: var(--bd-2);
  border-left: 6px solid var(--fault);
  background: var(--g-raised);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--g-ink);
}

.join__foot {
  border-top: 2px solid var(--g-line-hi);
  padding: var(--space-6) max(var(--space-4), var(--safe-l))
    calc(var(--space-10) + var(--safe-b));
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--g-ink-3);
}
</style>
