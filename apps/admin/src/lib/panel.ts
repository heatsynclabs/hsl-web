import { ApiError } from '@hsl/api-client'
import type { Ref } from 'vue'
import { ref, shallowRef } from 'vue'

/**
 * One panel of a screen that reads one thing from the API, with the loading and
 * refusal states LoadState renders.
 *
 * The door screen has five of them: the enrolment queue, the directory the
 * picker chooses from, the card table, the door status and the event log. Each
 * fails on its own, so a card table the API refuses does not empty the queue
 * beside it.
 */

export interface ApiPanel<T> {
  data: Ref<T>
  pending: Ref<boolean>
  error: Ref<ApiError | null>
  /** The first read, and the one a Try again button repeats. */
  load: () => Promise<void>
  /** A repeat read for a timer. It leaves what is on the screen alone when it fails. */
  refresh: () => Promise<void>
}

export function apiPanel<T>(read: () => Promise<T>, initial: T): ApiPanel<T> {
  const data = shallowRef<T>(initial)
  const pending = ref(true)
  const error = ref<ApiError | null>(null)

  async function load(): Promise<void> {
    pending.value = true
    error.value = null

    try {
      data.value = await read()
    } catch (thrown) {
      if (!(thrown instanceof ApiError)) throw thrown
      error.value = thrown
    } finally {
      pending.value = false
    }
  }

  async function refresh(): Promise<void> {
    try {
      data.value = await read()
    } catch (thrown) {
      // A poll that failed replaces nothing. The panel keeps the last answer it
      // had, and the reader is told how old it is by the answer itself.
      if (!(thrown instanceof ApiError)) throw thrown
    }
  }

  return { data, pending, error, load, refresh }
}
