#!/usr/bin/env node
// Checks prose against the lab voice rules in CONTRIBUTING.md section 11.
// Usage: node tools/voice-check.mjs [paths...]   (defaults to the tracked tree)
//
// A file may opt out with "voice-check: reference" in its first 40 lines.
// A block may opt out between "voice-check: quote" and "/voice-check: quote".

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BANNED_WORDS = [
  'unleash', 'elevate', 'empower', 'revolutionise', 'revolutionize',
  'transform your', 'game changer', 'game-changer', 'cutting edge',
  'cutting-edge', 'state of the art', 'seamless', 'synergy', 'ecosystem',
  'innovate', 'innovation', 'disrupt', 'world class', 'world-class',
  'best in class', 'best-in-class', 'passionate about', 'dive in', 'delve',
  'thrilled to announce', 'excited to share', 'we are proud to',
  'endless possibilities', 'one stop shop', 'one-stop shop',
  'thriving community', 'battle tested', 'battle-tested', 'war room',
  'mission critical', 'mission-critical',
]

// Patterns that need more than a substring match.
const BANNED_PATTERNS = [
  [/\bnot just\b[^.!?]{0,60}\bit'?s\b/i, 'the "not just X, it is Y" construction'],
  [/\bleverag(e|es|ed|ing)\b/i, '"leverage" as a verb'],
  [/\bwhether you'?re? a beginner\b/i, 'exclusion by implication'],
  [/\bfor serious (makers|builders|hackers)\b/i, 'exclusion by implication'],
  [/\bin (a|today'?s) (world|fast[- ]paced)\b/i, '"in a world where" opener'],
  [/\brobust community\b/i, '"robust" of a community'],
]

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u
const DASHES = /[—–]/

const EXTENSIONS = /\.(md|vue|ts|tsx|js|mjs|css|html|sql|yaml|yml)$/

function targets(args) {
  if (args.length > 0) return args
  const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
  return tracked.filter((f) => f && EXTENSIONS.test(f))
}

function findings(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  const lines = text.split('\n')
  if (lines.slice(0, 40).some((l) => l.includes('voice-check: reference'))) return []

  const out = []
  let quoting = false

  lines.forEach((line, i) => {
    if (line.includes('voice-check: quote')) {
      quoting = !line.includes('/voice-check: quote')
      return
    }
    if (quoting) return

    const at = (why) => out.push({ file, line: i + 1, why, text: line.trim().slice(0, 90) })
    const lower = line.toLowerCase()

    if (DASHES.test(line)) at('em dash or en dash')
    if (EMOJI.test(line)) at('emoji')
    for (const word of BANNED_WORDS) {
      if (lower.includes(word)) at(`banned word: ${word}`)
    }
    for (const [pattern, why] of BANNED_PATTERNS) {
      if (pattern.test(line)) at(why)
    }
  })

  return out
}

const all = targets(process.argv.slice(2)).flatMap(findings)

for (const f of all) {
  console.error(`${f.file}:${f.line}  ${f.why}\n    ${f.text}`)
}

if (all.length > 0) {
  console.error(`\nvoice-check: ${all.length} finding${all.length === 1 ? '' : 's'}.`)
  process.exit(1)
}

console.log('voice-check: clean')
