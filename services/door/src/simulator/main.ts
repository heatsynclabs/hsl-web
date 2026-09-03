import { pathToFileURL } from 'node:url'

import { serve } from '@hono/node-server'

import { createFakeDevice } from '../adapters/fake/device.ts'
import { createSimulatorApp } from './app.ts'

/**
 * A simulated door controller, so the door service can be run and demonstrated
 * without the board. It is a development tool: it runs from source, it is not
 * bundled, and it is in neither service image.
 *
 * Point the door service at it:
 *
 *   CONTROLLER_PASSWORD=0x1234 pnpm --filter @hsl/door simulator
 *   CONTROLLER_URL=http://127.0.0.1:8090 CONTROLLER_PASSWORD=0x1234 \
 *     API_URL=... DOOR_TOKEN=... pnpm --filter @hsl/door dev
 *
 * services/door/README.md has the whole loop, including holding a card to the
 * simulated reader.
 */

const DEFAULT_PORT = 8090

export function main(): void {
  const password = (process.env['CONTROLLER_PASSWORD'] ?? '').trim()
  if (password === '') {
    console.error(
      'CONTROLLER_PASSWORD is unset, so the simulator will not start. Set it to whatever you ' +
        'give the door service, so the two agree. The firmware ships 0x1234 as its example.',
    )
    process.exitCode = 1
    return
  }

  const port = Number(process.env['SIMULATOR_PORT'] ?? DEFAULT_PORT)
  const device = createFakeDevice({ password })
  const app = createSimulatorApp({
    device,
    onRequest: (query) => console.log(`simulator: ${query}`),
  })

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
  console.log(
    `simulator: a door controller on http://127.0.0.1:${port}, holding an empty card table.\n` +
      'simulator: this is not a door. It answers the way the board is documented to answer.',
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
