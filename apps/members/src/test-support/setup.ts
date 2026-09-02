import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach } from 'vitest'

// The suites mount into document.body so that submit buttons behave. Without
// this each test would leave its screen behind for the next one to find.
enableAutoUnmount(afterEach)
