/**
 * Light or dark, chosen by the person reading the screen.
 *
 * GANTRY carries both palettes and switches on a data-theme attribute on the
 * root element. Light is the default: these are screens people use in a lit
 * workshop during the day, and the paper ground is easier there. The door screen
 * is the one read in a dark building, and a member who wants dark gets it in one
 * click and keeps it.
 *
 * The choice is per browser rather than per member, because it belongs to the
 * screen you are looking at rather than to your membership, and because it has
 * to work on the sign in page before anybody knows who you are.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'light'

/** The key the inline script in each index.html uses. Change both together. */
export const THEME_STORAGE_KEY = 'hsl.theme'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * Reads the stored choice. Storage throws rather than returning null in a
 * browser set to block site data, so a failure here means the default, never a
 * blank screen.
 */
export function storedTheme(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(theme: Theme): void {
  globalThis.document?.documentElement.setAttribute('data-theme', theme)

  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // A browser that will not store it still gets the theme for this page.
  }
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light'
}
