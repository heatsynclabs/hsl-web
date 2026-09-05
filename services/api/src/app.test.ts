import { describe, expect, it } from 'vitest'

import { logSafeError } from './app.ts'

/**
 * A failing query used to be logged as the error object. drizzle puts every
 * bind parameter on it, once in the message and again in `params`, and pg puts
 * the offending values in `detail`. On this system those parameters are a
 * member's name, address and emergency contact, or a session token, or a
 * password reset token, and `make logs` is how a volunteer is told to look at
 * the system.
 *
 * The shape of the failure is what helps somebody fix it. The values never do.
 */
describe('what a failed request writes to the log', () => {
  const drizzleError = () => {
    const error = new Error(
      'Failed query: insert into "user" ("id", "name", "email") values ($1, $2, $3)\n' +
        'params: leak-probe,Probe Person,probe@example.test,480 555 0177',
    )
    error.name = 'DrizzleQueryError'
    error.cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      table: 'user',
      constraint: 'user_email_unique',
      detail: 'Key (email)=(probe@example.test) already exists.',
    })
    return error
  }

  it('keeps the statement, which is parameterised and says what was being done', () => {
    expect(logSafeError(drizzleError())).toContain('insert into "user"')
  })

  it('names the constraint and the table, which is what a person needs to fix it', () => {
    const logged = logSafeError(drizzleError())

    expect(logged).toContain('23505')
    expect(logged).toContain('user_email_unique')
  })

  it('writes no bind parameter, so a member record cannot reach the log', () => {
    const logged = logSafeError(drizzleError())

    expect(logged).not.toContain('Probe Person')
    expect(logged).not.toContain('480 555 0177')
    expect(logged).not.toContain('params:')
  })

  it('writes no pg detail, which repeats the offending value', () => {
    expect(logSafeError(drizzleError())).not.toContain('probe@example.test')
  })

  it('says something useful about a value that was not an Error at all', () => {
    expect(logSafeError('a bare string')).toContain('not an Error')
  })
})
