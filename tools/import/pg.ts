import { createRequire } from 'node:module'

/**
 * tools/ has no package.json of its own, so Node resolves a bare specifier from
 * the directory this file sits in and finds nothing. pg is installed for the
 * API service, the only other thing in the repository that opens a connection,
 * so resolution starts from that package instead.
 *
 * The surface below is the part of pg this script uses, written out rather than
 * imported from @types/pg for the same reason: the type packages resolve from
 * services/api and not from here.
 */
const requireFromApiService = createRequire(
  new URL('../../services/api/package.json', import.meta.url),
)

export interface QueryResult<Row> {
  rows: Row[]
  rowCount: number | null
}

export interface Client {
  connect(): Promise<void>
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>
  end(): Promise<void>
}

interface ClientConstructor {
  new (config: { connectionString: string; application_name?: string }): Client
}

interface PgModule {
  Client: ClientConstructor
  types: { setTypeParser: (oid: number, parse: (value: string) => unknown) => void }
}

const pg = requireFromApiService('pg') as PgModule

/**
 * numeric arrives as a string and stays one. Turning payments.amount into a
 * JavaScript number before the conversion to cents would round money, and the
 * legacy column is an unconstrained numeric with no declared scale.
 */
const NUMERIC_OID = 1700
pg.types.setTypeParser(NUMERIC_OID, (value: string) => value)

export function createClient(connectionString: string, applicationName: string): Client {
  return new pg.Client({ connectionString, application_name: applicationName })
}
