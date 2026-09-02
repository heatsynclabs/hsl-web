import type { z } from 'zod'

import { errorResponse } from '@hsl/schema'

/**
 * The only error this client throws. Section 7 of CONTRIBUTING.md asks an error
 * to say what happened, what the system did, and what to do next, so the message
 * is built from those three parts in that order. The parts also stay on the
 * instance, because a screen that wants to render the problem on its own should
 * not have to read the sentence back apart.
 */

interface ApiErrorFields {
  method: string
  path: string
  status: number
  body: unknown
  message: string
  cause?: unknown
}

/** What a reader should do next, by status. Anything absent falls back below. */
const NEXT_STEP: Record<number, string> = {
  400: 'Check the values that were sent and try again.',
  401: 'Sign in and try again.',
  403: 'This account may not do that. Ask an admin whether it should be allowed to.',
  404: 'Check the address, and check that the record still exists.',
  409: 'Reload the record, reapply the change and send it again.',
  422: 'Check the values that were sent and try again.',
  429: 'Wait a moment and try again.',
  // The API answers 503 when the lab link is down. See docs/architecture.md.
  503: 'The lab link or the database is down. Physical cards still work. Try again in a minute.',
}

const SERVER_ERROR_FLOOR = 500
const ISSUES_SHOWN = 3

function nextStep(status: number): string {
  const known = NEXT_STEP[status]
  if (known !== undefined) return known
  if (status >= SERVER_ERROR_FLOOR) {
    return 'Try again in a minute, then read the API log for this request.'
  }
  return 'Check the request and try again.'
}

/** The API sends { error } on every refusal, so pull the sentence out when it is there. */
function problemText(body: unknown): string | null {
  const parsed = errorResponse.safeParse(body)
  return parsed.success ? parsed.data.error : null
}

function describeIssues(error: z.ZodError): string {
  const shown = error.issues.slice(0, ISSUES_SHOWN).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : 'the body'
    return `${where}: ${issue.message}`
  })
  const rest = error.issues.length - shown.length
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ')
}

export class ApiError extends Error {
  readonly method: string
  readonly path: string
  /** The HTTP status. Zero when no response arrived at all. */
  readonly status: number
  /** The parsed response body, or the raw text when it was not JSON. */
  readonly body: unknown
  /** The API's own sentence about the problem, when it sent one. */
  readonly problem: string | null

  constructor(fields: ApiErrorFields) {
    super(fields.message, { cause: fields.cause })
    this.name = 'ApiError'
    this.method = fields.method
    this.path = fields.path
    this.status = fields.status
    this.body = fields.body
    this.problem = problemText(fields.body)
  }

  static refused(fields: Omit<ApiErrorFields, 'message'>): ApiError {
    const problem = problemText(fields.body)
    const said = problem === null ? '' : `: ${problem}`
    const message =
      `${fields.method} ${fields.path} was refused with ${fields.status}${said}. ` +
      `Nothing was returned to the caller. ${nextStep(fields.status)}`
    return new ApiError({ ...fields, message })
  }

  static malformed(fields: Omit<ApiErrorFields, 'message'> & { issues: z.ZodError }): ApiError {
    const message =
      `${fields.method} ${fields.path} answered ${fields.status} with a body the contract in ` +
      `@hsl/schema does not accept (${describeIssues(fields.issues)}). The client threw rather ` +
      'than hand back a half wrong record. Make the route and the schema agree.'
    return new ApiError({ ...fields, message, cause: fields.issues })
  }

  static unreachable(fields: Omit<ApiErrorFields, 'message' | 'status' | 'body'>): ApiError {
    const message =
      `${fields.method} ${fields.path} got no response at all. Nothing was returned to the ` +
      'caller, and the request may or may not have run. Check that the API is up and that ' +
      'this browser is on a network that can reach it.'
    return new ApiError({ ...fields, status: 0, body: null, message })
  }
}
