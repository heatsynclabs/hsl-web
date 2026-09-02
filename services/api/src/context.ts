import type { Member } from '@hsl/schema'

import type { Auth } from './auth.ts'
import type { Config } from './config.ts'
import type { Database } from './db.ts'

/**
 * What every route group is handed, and what the session middleware puts on the
 * request. Kept in its own file so a route can import the shape without
 * importing the app that builds it.
 */

export interface AppDeps {
  db: Database
  auth: Auth
  config: Config
}

export interface AppEnv {
  Variables: {
    /** The member row as it is in the database right now, or null when nobody is signed in. */
    member: Member | null
  }
}
