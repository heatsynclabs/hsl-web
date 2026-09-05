import { createServer } from 'node:http'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHttpTransport } from './controller.ts'

/**
 * A board that accepts the connection and then says nothing is the ordinary
 * failure of a 2013 Arduino on a shared LAN. Node's fetch waits on undici's
 * default of 300 seconds, measured on node:24.20-alpine, and the loop's running
 * guard skips every tick until it returns, so five minutes of a wedged board is
 * five minutes of a door service that reports nothing and runs no command.
 *
 * This drives the real transport over a real socket, because the thing under
 * test is what fetch does, and a mocked transport would prove nothing.
 */
describe('a controller that accepts the connection and never answers', () => {
  let server: ReturnType<typeof createServer>
  let port = 0

  beforeAll(async () => {
    server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('gives up rather than holding the pass open', async () => {
    const transport = createHttpTransport(`http://127.0.0.1:${port}`, 250)

    await expect(transport('?9')).rejects.toThrow(/did not answer/)
  })

  it('says what to do next, and never prints the password', async () => {
    const transport = createHttpTransport(`http://127.0.0.1:${port}`, 250)

    const message = await transport('?9&e=1234').catch((error: Error) => error.message)

    expect(message).toContain('power cycle')
    expect(message).not.toContain('1234')
  })
})
