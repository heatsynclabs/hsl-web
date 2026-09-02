// The 29 HeatSync marks, inlined as raw SVG so a mark needs no network request
// and inherits colour from its container. Source: the GANTRY brand pack shipping
// in heatsynclabs/new-hsl, copied into src/marks unchanged.

import HslAvatarDark from './marks/hsl-avatar-dark.svg?raw'
import HslAvatarHazard from './marks/hsl-avatar-hazard.svg?raw'
import HslAvatarPaper from './marks/hsl-avatar-paper.svg?raw'
import HslAvatarRoundDark from './marks/hsl-avatar-round-dark.svg?raw'
import HslBadgeDark from './marks/hsl-badge-dark.svg?raw'
import HslBadgeEst from './marks/hsl-badge-est.svg?raw'
import HslBadgeHazard from './marks/hsl-badge-hazard.svg?raw'
import HslBadgePaper from './marks/hsl-badge-paper.svg?raw'
import HslLockupH from './marks/hsl-lockup-h.svg?raw'
import HslLockupH1cBone from './marks/hsl-lockup-h-1c-bone.svg?raw'
import HslLockupH1cHazard from './marks/hsl-lockup-h-1c-hazard.svg?raw'
import HslLockupH1cInk from './marks/hsl-lockup-h-1c-ink.svg?raw'
import HslLockupHReverse from './marks/hsl-lockup-h-reverse.svg?raw'
import HslLockupStack from './marks/hsl-lockup-stack.svg?raw'
import HslLockupStack1cInk from './marks/hsl-lockup-stack-1c-ink.svg?raw'
import HslLockupStackReverse from './marks/hsl-lockup-stack-reverse.svg?raw'
import HslMark from './marks/hsl-mark.svg?raw'
import HslMark1cBone from './marks/hsl-mark-1c-bone.svg?raw'
import HslMark1cCurrent from './marks/hsl-mark-1c-current.svg?raw'
import HslMark1cHazard from './marks/hsl-mark-1c-hazard.svg?raw'
import HslMark1cInk from './marks/hsl-mark-1c-ink.svg?raw'
import HslMarkCurrent from './marks/hsl-mark-current.svg?raw'
import HslMarkHazard from './marks/hsl-mark-hazard.svg?raw'
import HslMarkReverse from './marks/hsl-mark-reverse.svg?raw'
import HslPlateCaution from './marks/hsl-plate-caution.svg?raw'
import HslWordmarkBone from './marks/hsl-wordmark-bone.svg?raw'
import HslWordmarkCurrent from './marks/hsl-wordmark-current.svg?raw'
import HslWordmarkHazard from './marks/hsl-wordmark-hazard.svg?raw'
import HslWordmarkInk from './marks/hsl-wordmark-ink.svg?raw'

export const markNames = [
  'hsl-avatar-dark',
  'hsl-avatar-hazard',
  'hsl-avatar-paper',
  'hsl-avatar-round-dark',
  'hsl-badge-dark',
  'hsl-badge-est',
  'hsl-badge-hazard',
  'hsl-badge-paper',
  'hsl-lockup-h',
  'hsl-lockup-h-1c-bone',
  'hsl-lockup-h-1c-hazard',
  'hsl-lockup-h-1c-ink',
  'hsl-lockup-h-reverse',
  'hsl-lockup-stack',
  'hsl-lockup-stack-1c-ink',
  'hsl-lockup-stack-reverse',
  'hsl-mark',
  'hsl-mark-1c-bone',
  'hsl-mark-1c-current',
  'hsl-mark-1c-hazard',
  'hsl-mark-1c-ink',
  'hsl-mark-current',
  'hsl-mark-hazard',
  'hsl-mark-reverse',
  'hsl-plate-caution',
  'hsl-wordmark-bone',
  'hsl-wordmark-current',
  'hsl-wordmark-hazard',
  'hsl-wordmark-ink',
] as const

export type MarkName = (typeof markNames)[number]

export const markSources: Record<MarkName, string> = {
  'hsl-avatar-dark': HslAvatarDark,
  'hsl-avatar-hazard': HslAvatarHazard,
  'hsl-avatar-paper': HslAvatarPaper,
  'hsl-avatar-round-dark': HslAvatarRoundDark,
  'hsl-badge-dark': HslBadgeDark,
  'hsl-badge-est': HslBadgeEst,
  'hsl-badge-hazard': HslBadgeHazard,
  'hsl-badge-paper': HslBadgePaper,
  'hsl-lockup-h': HslLockupH,
  'hsl-lockup-h-1c-bone': HslLockupH1cBone,
  'hsl-lockup-h-1c-hazard': HslLockupH1cHazard,
  'hsl-lockup-h-1c-ink': HslLockupH1cInk,
  'hsl-lockup-h-reverse': HslLockupHReverse,
  'hsl-lockup-stack': HslLockupStack,
  'hsl-lockup-stack-1c-ink': HslLockupStack1cInk,
  'hsl-lockup-stack-reverse': HslLockupStackReverse,
  'hsl-mark': HslMark,
  'hsl-mark-1c-bone': HslMark1cBone,
  'hsl-mark-1c-current': HslMark1cCurrent,
  'hsl-mark-1c-hazard': HslMark1cHazard,
  'hsl-mark-1c-ink': HslMark1cInk,
  'hsl-mark-current': HslMarkCurrent,
  'hsl-mark-hazard': HslMarkHazard,
  'hsl-mark-reverse': HslMarkReverse,
  'hsl-plate-caution': HslPlateCaution,
  'hsl-wordmark-bone': HslWordmarkBone,
  'hsl-wordmark-current': HslWordmarkCurrent,
  'hsl-wordmark-hazard': HslWordmarkHazard,
  'hsl-wordmark-ink': HslWordmarkInk,
}
