import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.ts'

/**
 * Configuration is parsed once at boot so a missing value stops the process
 * with something a volunteer can act on, rather than failing on the first
 * request that happens to need it.
 */

const complete = {
  DATABASE_URL: 'postgres://hsl@db:5432/hsl',
  PUBLIC_ORIGIN: 'https://members.heatsynclabs.org',
  AUTH_SECRET: 'a secret that is long enough',
  DOOR_TOKEN: 'a door token that is long enough',
  // An https origin means a real deployment, and one of those has to be able to
  // send password reset mail. Deliberately not the development mail catcher:
  // this fixture is what the suite believes a production environment looks
  // like, and it used to be smtp://mail:1025, which is the thing the guard in
  // config.ts now refuses. See password-reset.test.ts.
  SMTP_URL: 'smtps://user:pw@smtp.example.org:465',
}

describe('reading the environment', () => {
  it('names every missing variable in one message', () => {
    let message = ''
    try {
      loadConfig({})
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('PUBLIC_ORIGIN')
    expect(message).toContain('AUTH_SECRET')
    expect(message).toContain('DOOR_TOKEN')
  })

  it('refuses a public origin that is not a URL', () => {
    expect(() => loadConfig({ ...complete, PUBLIC_ORIGIN: 'members.heatsynclabs.org' })).toThrow(
      /PUBLIC_ORIGIN/,
    )
  })

  it('sets secure cookies for an https origin', () => {
    expect(loadConfig(complete).useSecureCookies).toBe(true)
  })

  it('leaves secure cookies off for a plain http origin, which is how development runs', () => {
    const config = loadConfig({ ...complete, PUBLIC_ORIGIN: 'http://localhost:3000' })
    expect(config.useSecureCookies).toBe(false)
  })

  it('reads a secret from the file Compose mounted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hsl-config-'))
    const path = join(directory, 'auth_secret')
    writeFileSync(path, 'a secret from a mounted file\n')

    const config = loadConfig({
      ...complete,
      AUTH_SECRET: undefined,
      AUTH_SECRET_FILE: path,
    })

    expect(config.authSecret).toBe('a secret from a mounted file')
  })

  it('says which file it could not read', () => {
    expect(() =>
      loadConfig({ ...complete, AUTH_SECRET: undefined, AUTH_SECRET_FILE: '/no/such/secret' }),
    ).toThrow(/\/no\/such\/secret/)
  })

  /**
   * pg lets a connection string win over an explicit password, so the password
   * has to go into the string rather than beside it.
   */
  it('puts the database password into the connection string', () => {
    const config = loadConfig({ ...complete, DATABASE_PASSWORD: 'a password with a / in it' })

    expect(config.databaseUrl).toContain('hsl:a%20password%20with%20a%20%2F%20in%20it@')
  })

  it('defaults the port to the one the Dockerfile exposes', () => {
    expect(loadConfig(complete).port).toBe(3000)
  })
})
