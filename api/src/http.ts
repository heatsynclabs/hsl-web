import type { Context } from 'hono'

/** JSON in, JSON out. A body that is not JSON is an empty one, never a crash. */
export async function body(c: Context): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => null)
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
}

/** Longest honest free text field. Anything above it is a mistake or an attack. */
export const TEXT_LIMIT = 2000

/** A trimmed string, or null for anything that is not one. Unknown fields are ignored. */
export function text(value: unknown, limit = TEXT_LIMIT): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > limit ? null : trimmed
}

/** A path parameter. Hono types these as optional; a matched route always has it. */
export function param(c: Context, name: string): string {
  return c.req.param(name) ?? ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A uuid, or null.
 *
 * Every id in this system is one, and Postgres refuses anything else with an
 * error rather than an empty result. Without this a mistyped URL reads as the
 * database being down, both to the person who typed it and in the log.
 */
export function uuid(value: unknown): string | null {
  const given = text(value, 64)
  return given !== null && UUID.test(given) ? given : null
}

export function bad(c: Context, message: string): Response {
  return c.json({ error: message }, 400)
}

export function missing(c: Context, what: string): Response {
  return c.json({ error: `${what} does not exist here.` }, 404)
}

const DEFAULT_PAGE = 100
const MAX_PAGE = 500

/** Paginated lists take ?limit and ?before, and answer { items, next }. */
export function page(c: Context): { limit: number; before: number | null } {
  const limit = Number(c.req.query('limit') ?? DEFAULT_PAGE)
  const before = Number(c.req.query('before'))
  return {
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE) : DEFAULT_PAGE,
    before: Number.isFinite(before) && before > 0 ? Math.trunc(before) : null,
  }
}
