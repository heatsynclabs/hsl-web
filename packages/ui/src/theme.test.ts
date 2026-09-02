import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyTheme,
  DEFAULT_THEME,
  isTheme,
  otherTheme,
  storedTheme,
  THEME_STORAGE_KEY,
} from './theme'

/**
 * Storage is the part worth testing. A browser set to block site data throws
 * from localStorage rather than returning null, and a design system that lets
 * that reach the caller turns a privacy setting into a blank screen.
 */
function withStorage(storage: unknown): void {
  vi.stubGlobal('localStorage', storage)
}

/**
 * These suites render on the server, so there is no DOM. The attribute the
 * token file switches on is the only part of it applyTheme touches.
 */
function withRootElement(): { attributes: Record<string, string> } {
  const attributes: Record<string, string> = {}
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value
      },
    },
  })
  return { attributes }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the stored theme', () => {
  it('is light for somebody who has never chosen', () => {
    withStorage({ getItem: () => null })

    expect(storedTheme()).toBe('light')
    expect(DEFAULT_THEME).toBe('light')
  })

  it('is what the member chose last time', () => {
    withStorage({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? 'dark' : null) })

    expect(storedTheme()).toBe('dark')
  })

  it('falls back to light when the stored value is not a theme', () => {
    withStorage({ getItem: () => 'chartreuse' })

    expect(storedTheme()).toBe('light')
  })

  it('falls back to light when the browser refuses to read storage at all', () => {
    withStorage({
      getItem: () => {
        throw new Error('The user denied site data')
      },
    })

    expect(storedTheme()).toBe('light')
  })
})

describe('applying a theme', () => {
  it('puts it on the root element, which is what the token file switches on', () => {
    withStorage({ setItem: () => undefined })
    const root = withRootElement()

    applyTheme('dark')

    expect(root.attributes['data-theme']).toBe('dark')
  })

  it('still themes the page when the browser refuses to store the choice', () => {
    withStorage({
      setItem: () => {
        throw new Error('The user denied site data')
      },
    })
    const root = withRootElement()

    expect(() => applyTheme('dark')).not.toThrow()
    expect(root.attributes['data-theme']).toBe('dark')
  })
})

describe('the two themes', () => {
  it('names the one the toggle would switch to', () => {
    expect(otherTheme('light')).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
  })

  it('recognises only the two that tokens.css defines', () => {
    expect(isTheme('light')).toBe(true)
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('system')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})
