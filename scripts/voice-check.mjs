// voice-check: reference
//
// The bans in CONTRIBUTING.md section 11, checked rather than hoped for. A file
// whose job is to document them carries `voice-check: reference` in its first
// forty lines. A block quoting somebody else's words is wrapped in
// `<!-- voice-check: quote -->` and `<!-- /voice-check: quote -->`.
//
//   node scripts/voice-check.mjs

import { readdir, readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const SKIP = new Set(['node_modules', '.git', 'backups', 'dist'])
const CHECKED = /\.(md|ts|mjs|sql|yml|yaml)$/

const DASHES = /[\u2013\u2014]/
// Emoji_Presentation rather than Extended_Pictographic, which also matches the
// arrows and geometric shapes a plain diagram is drawn with. U+FE0F is the
// variation selector that forces emoji presentation onto one of those.
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u

/** Lifted from the HeatSync brand guide. Machine written copy reaches for these. */
const VOCABULARY = [
  'unleash', 'elevate', 'empower', 'revolutionise', 'revolutionize', 'transform your',
  'game changer', 'cutting edge', 'state of the art', 'seamless', 'leverage',
  'synergy', 'innovate', 'innovation', 'disrupt', 'world class', 'best in class',
  'passionate about', 'dive in', 'delve', 'thrilled to announce', 'excited to share',
  'we are proud to', 'endless possibilities', 'one stop shop', 'thriving community',
]

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) yield* walk(path)
    else if (CHECKED.test(entry.name)) yield path
  }
}

function quoted(lines) {
  const inside = new Set()
  let open = false
  lines.forEach((line, index) => {
    if (line.includes('<!-- voice-check: quote -->')) open = true
    if (open) inside.add(index)
    if (line.includes('<!-- /voice-check: quote -->')) open = false
  })
  return inside
}

let failures = 0

for await (const path of walk(ROOT)) {
  const body = await readFile(path, 'utf8')
  const lines = body.split('\n')
  const reference = lines.slice(0, 40).some((line) => line.includes('voice-check: reference'))
  const skip = quoted(lines)
  const name = path.pathname.replace(ROOT.pathname, '')

  lines.forEach((line, index) => {
    if (skip.has(index) || reference) return

    const say = (what) => {
      process.stdout.write(`${name}:${index + 1}: ${what}\n`)
      failures += 1
    }

    if (DASHES.test(line)) say('an em dash or en dash. Restructure the sentence.')
    if (EMOJI.test(line)) say('an emoji. Use an inline SVG from the icon set, or nothing.')

    for (const word of VOCABULARY) {
      if (line.toLowerCase().includes(word)) say(`the word "${word}", which is on the list.`)
    }
  })
}

if (failures > 0) {
  process.stdout.write(`\n${failures} to fix. CONTRIBUTING.md section 11 says why.\n`)
  process.exit(1)
}
process.stdout.write('voice ok\n')
