import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { createAuth } from './auth.ts'
import { loadConfig } from './config.ts'
import { createDatabase } from './db.ts'

const config = loadConfig()
const { db } = createDatabase(config)
const auth = createAuth(db, config)
const app = createApp({ db, auth, config })

serve({ fetch: app.fetch, port: config.port }, (address) => {
  console.log(`[api] listening on port ${address.port}, serving ${config.publicOrigin}`)
})
