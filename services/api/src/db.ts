import {
  account,
  auditLog,
  cards,
  certifications,
  doorEvents,
  payments,
  session,
  user,
  userCertifications,
  verification,
  waivers,
} from '@hsl/schema'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { Config } from './config.ts'

/**
 * The one connection pool. Nothing else in the repository opens one: apps talk
 * to this service and the door service holds no database credential.
 */

export const schema = {
  account,
  auditLog,
  cards,
  certifications,
  doorEvents,
  payments,
  session,
  user,
  userCertifications,
  verification,
  waivers,
}

export type Database = ReturnType<typeof createDatabase>['db']

export function createDatabase(config: Pick<Config, 'databaseUrl'>) {
  const pool = new Pool({ connectionString: config.databaseUrl })
  const db = drizzle(pool, { schema })

  return { pool, db }
}
