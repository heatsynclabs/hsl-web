import postgres from 'postgres'

import { config } from './config.ts'

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
})

export type Sql = typeof sql
