// The HeatSync marks. Source: the GANTRY brand pack shipping in
// heatsynclabs/new-hsl, copied into src/marks unchanged.
//
// Only the three "current" variants are inlined here, because they are the only
// ones a themed screen can use: they paint with fill="currentColor" and so take
// the ink of whatever ground they sit on. The other 26 are fixed colour, for
// print, stickers, favicons and social cards, and a web app that used one would
// have a mark that stops being legible the moment the theme flips.
//
// All 29 are still in src/marks and are still published, so anything that wants
// a fixed colour mark imports the file it needs:
//
//   import badge from '@hsl/ui/marks/hsl-badge-hazard.svg?raw'
//
// Importing them here instead would put roughly 470 kB of path data into every
// app bundle to render one logo in an app bar.

import HslMark1cCurrent from './marks/hsl-mark-1c-current.svg?raw'
import HslMarkCurrent from './marks/hsl-mark-current.svg?raw'
import HslWordmarkCurrent from './marks/hsl-wordmark-current.svg?raw'

export const markNames = ['hsl-mark-1c-current', 'hsl-mark-current', 'hsl-wordmark-current'] as const

export type MarkName = (typeof markNames)[number]

export const markSources: Record<MarkName, string> = {
  'hsl-mark-1c-current': HslMark1cCurrent,
  'hsl-mark-current': HslMarkCurrent,
  'hsl-wordmark-current': HslWordmarkCurrent,
}
