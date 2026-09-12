import postgres from 'postgres'

import { config } from './config.ts'
import { log } from './log.ts'

/**
 * Columns are snake_case in SQL and camelCase in JavaScript, translated here so
 * neither side carries the other's spelling.
 *
 * The column transform only. `postgres.camel` also rewrites the keys inside
 * every jsonb value, and `door_placements.placement` is a value this service is
 * forbidden to look inside. Renaming its keys would be reading it.
 */
export const sql = postgres(config.databaseUrl, {
  transform: { column: { to: postgres.fromCamel, from: postgres.toCamel } },
  // Postgres notices print as a raw object on stderr otherwise, which in a log
  // of one JSON line per event reads as something having gone wrong.
  onnotice: (notice) => log({ evt: 'db_notice', message: notice.message ?? String(notice) }),
})

export type Sql = typeof sql
