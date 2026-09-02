import { zValidator } from '@hono/zod-validator'
import type { ErrorResponse } from '@hsl/schema'
import type { $ZodIssue, $ZodType } from 'zod/v4/core'

/**
 * Request validation against the contracts in @hsl/schema, with a refusal that
 * says which field was wrong in the shape the apps already parse.
 *
 * Every request body schema is strict, so an unknown key is refused here rather
 * than dropped. That is what closes the legacy attr_accessible defect: a member
 * cannot smuggle admin or member_level into a profile edit.
 */

function describe(issues: readonly $ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ')
}

export function jsonBody<T extends $ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (result.success) return
    const body: ErrorResponse = {
      error: `The request body was refused and nothing was changed. ${describe(result.error.issues)}`,
    }
    return c.json(body, 400)
  })
}

export function queryParameters<T extends $ZodType>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (result.success) return
    const body: ErrorResponse = {
      error: `The query string was refused. ${describe(result.error.issues)}`,
    }
    return c.json(body, 400)
  })
}
