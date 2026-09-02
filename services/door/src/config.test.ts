import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.ts'

const BASE = {
  CONTROLLER_URL: 'http://192.168.1.177',
  API_URL: 'https://members.heatsynclabs.org',
}

function secretFile(name: string, value: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hsl-door-')), name)
  writeFileSync(path, `${value}\n`)
  return path
}

describe('what the door service needs before it starts', () => {
  it('reads both secrets from the files compose mounts', () => {
    const config = loadConfig({
      ...BASE,
      CONTROLLER_PASSWORD_FILE: secretFile('controller_password', '1234'),
      DOOR_TOKEN_FILE: secretFile('door_token', 'a-shared-token'),
    })

    expect(config.controllerPassword).toBe('1234')
    expect(config.doorToken).toBe('a-shared-token')
    expect(config.controllerUrl).toBe('http://192.168.1.177')
    expect(config.port).toBe(8080)
    expect(config.reconcileIntervalSeconds).toBe(60)
  })

  it('takes plain variables for development', () => {
    const config = loadConfig({
      ...BASE,
      CONTROLLER_PASSWORD: '1234',
      DOOR_TOKEN: 'a-shared-token',
      PORT: '9090',
      RECONCILE_INTERVAL_SECONDS: '15',
    })

    expect(config.port).toBe(9090)
    expect(config.reconcileIntervalSeconds).toBe(15)
  })

  it('drops a trailing slash so the query string is appended cleanly', () => {
    const config = loadConfig({
      ...BASE,
      CONTROLLER_URL: 'http://192.168.1.177/',
      CONTROLLER_PASSWORD: '1234',
      DOOR_TOKEN: 'a-shared-token',
    })
    expect(config.controllerUrl).toBe('http://192.168.1.177')
  })

  it('refuses to start without the controller password, and names the variable', () => {
    expect(() => loadConfig({ ...BASE, DOOR_TOKEN: 'a-shared-token' }))
      .toThrow(/CONTROLLER_PASSWORD is unset or empty/)
  })

  it('refuses to start without the door token', () => {
    expect(() => loadConfig({ ...BASE, CONTROLLER_PASSWORD: '1234' }))
      .toThrow(/DOOR_TOKEN is unset or empty/)
  })

  it('never puts the controller password in the message', () => {
    const path = secretFile('controller_password', '')
    const failure = attempt(() => loadConfig({ ...BASE, CONTROLLER_PASSWORD_FILE: path, DOOR_TOKEN: 'token' }))
    expect(String(failure)).toContain('CONTROLLER_PASSWORD')
    expect(String(failure)).not.toContain('1234')
  })

  it('says which file it could not read', () => {
    const failure = attempt(() =>
      loadConfig({ ...BASE, CONTROLLER_PASSWORD_FILE: '/run/secrets/nothing-here', DOOR_TOKEN: 'token' }),
    )
    expect(String(failure)).toContain('/run/secrets/nothing-here')
  })

  it('refuses an address that is not a URL, before anything is sent', () => {
    expect(() =>
      loadConfig({ ...BASE, CONTROLLER_URL: '192.168.1.177', CONTROLLER_PASSWORD: '1234', DOOR_TOKEN: 'token' }),
    ).toThrow(/will not start/)
  })
})

function attempt(run: () => unknown): unknown {
  try {
    run()
    return null
  } catch (error) {
    return error
  }
}
