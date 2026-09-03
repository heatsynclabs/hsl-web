import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach } from 'vitest'

// A mounted component is not torn down on its own, so without this each test
// leaves its screen behind for the next one to find.
enableAutoUnmount(afterEach)
