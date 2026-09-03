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

/**
 * The board reads four characters after e= and parses them as hex, so a value
 * that looks right in the sketch is the wrong thing to put here. Refusing at
 * startup turns a silent authfail on every request into one readable sentence.
 */
describe('the controller password', () => {
  const base = {
    CONTROLLER_URL: 'http://192.0.2.10',
    API_URL: 'https://members.example.test',
    DOOR_TOKEN: 'a door token that is long enough',
  }

  it('takes the four hex characters the board compares', () => {
    expect(loadConfig({ ...base, CONTROLLER_PASSWORD: '1234' }).controllerPassword).toBe('1234')
  })

  it('refuses the C literal from the sketch, which the board would read as 0x12', () => {
    expect(() => loadConfig({ ...base, CONTROLLER_PASSWORD: '0x1234' })).toThrow(
      /four hex characters/,
    )
  })

  it('refuses a value the board would truncate or read as zero', () => {
    expect(() => loadConfig({ ...base, CONTROLLER_PASSWORD: 'hunter2' })).toThrow(/four hex/)
    expect(() => loadConfig({ ...base, CONTROLLER_PASSWORD: '12345' })).toThrow(/four hex/)
  })

  it('refuses the logout value, which can never authenticate', () => {
    expect(() => loadConfig({ ...base, CONTROLLER_PASSWORD: '0000' })).toThrow(/logs out with/)
  })

  it('listens on loopback unless told otherwise, because it holds that password', () => {
    expect(loadConfig({ ...base, CONTROLLER_PASSWORD: '1234' }).host).toBe('127.0.0.1')
    expect(loadConfig({ ...base, CONTROLLER_PASSWORD: '1234', HOST: '0.0.0.0' }).host).toBe(
      '0.0.0.0',
    )
  })
})
