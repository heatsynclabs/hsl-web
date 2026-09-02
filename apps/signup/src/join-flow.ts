import type { ApiClient } from '@hsl/api-client'
import { ApiError } from '@hsl/api-client'
import type { SignupResponse } from '@hsl/schema'
import { memberLevelLabel, signupRequest, signupTier } from '@hsl/schema'
import { reactive } from 'vue'
import type { z } from 'zod'

/**
 * Everything the join flow holds between its screens, and the one call that
 * sends it. The draft lives here rather than in a view because a person moves
 * back and forth across five screens before anything is sent, and because the
 * router guard has to know which screens they have earned.
 *
 * Nothing is sent until the last step. There is no half created member.
 */

export type SignupTier = z.infer<typeof signupTier>

export interface JoinDraft {
  name: string
  email: string
  password: string
  phone: string
  emergencyName: string
  emergencyPhone: string
  waiverAccepted: boolean
  memberLevel: SignupTier | null
}

export const STEP_NAMES = ['account', 'emergency', 'waiver', 'tier', 'done'] as const
export type StepName = (typeof STEP_NAMES)[number]

/** The four a person fills in. done is the receipt, and it has no fields. */
const EDITABLE_STEPS = ['account', 'emergency', 'waiver', 'tier'] as const

export const STEP_LABELS: Record<StepName, string> = {
  account: 'Account',
  emergency: 'Emergency',
  waiver: 'Waiver',
  tier: 'Dues',
  done: 'Next',
}

type FieldName = keyof JoinDraft

const STEP_FIELDS: Record<(typeof EDITABLE_STEPS)[number], readonly FieldName[]> = {
  account: ['name', 'email', 'password', 'phone'],
  emergency: ['emergencyName', 'emergencyPhone'],
  waiver: ['waiverAccepted'],
  tier: ['memberLevel'],
}

/**
 * What a person reads when signupRequest refuses a field. The schema decides
 * what is valid; these sentences only say it in the lab's words.
 */
const FIELD_MESSAGE: Record<FieldName, string> = {
  name: 'Enter the name the lab should have on your record.',
  email: 'Enter an email address you can read. It is also how you sign in.',
  password: 'Choose a password of at least 8 characters.',
  phone: 'That phone number is longer than the members database accepts.',
  emergencyName: 'That name is longer than the members database accepts.',
  emergencyPhone: 'That phone number is longer than the members database accepts.',
  waiverAccepted: 'Tick the box to accept the release before you carry on.',
  memberLevel: 'Choose one of the four options.',
}

export interface JoinFailure {
  message: string
  /** True when the answer is to sign in rather than to try again. */
  offerSignIn: boolean
}

export interface JoinState {
  draft: JoinDraft
  /** A step a person has tried to leave. Errors stay hidden until then. */
  attempted: Record<StepName, boolean>
  submitting: boolean
  failure: JoinFailure | null
  created: SignupResponse | null
}

function fresh(): JoinState {
  return {
    draft: {
      name: '',
      email: '',
      password: '',
      phone: '',
      emergencyName: '',
      emergencyPhone: '',
      waiverAccepted: false,
      memberLevel: null,
    },
    attempted: { account: false, emergency: false, waiver: false, tier: false, done: false },
    submitting: false,
    failure: null,
    created: null,
  }
}

export const join = reactive<JoinState>(fresh())

/** Start over. The last screen offers it, and every test starts from it. */
export function resetJoin(): void {
  Object.assign(join, fresh())
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** The body POST /api/signup is given, built once so validation and sending agree. */
function payloadFrom(draft: JoinDraft): unknown {
  return {
    name: draft.name.trim(),
    email: draft.email.trim(),
    password: draft.password,
    phone: optional(draft.phone),
    emergencyName: optional(draft.emergencyName),
    emergencyPhone: optional(draft.emergencyPhone),
    memberLevel: draft.memberLevel,
    waiverAccepted: draft.waiverAccepted,
  }
}

/** Every field signupRequest refuses, in the lab's words. Empty when it is happy. */
export function fieldErrors(draft: JoinDraft): Partial<Record<FieldName, string>> {
  const parsed = signupRequest.safeParse(payloadFrom(draft))
  if (parsed.success) return {}

  const found: Partial<Record<FieldName, string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as FieldName | undefined
    if (field === undefined) continue
    found[field] = FIELD_MESSAGE[field] ?? issue.message
  }
  return found
}

/** The errors one screen owns, and only once a person has tried to leave it. */
export function errorsOn(step: StepName): Partial<Record<FieldName, string>> {
  if (!join.attempted[step] || step === 'done') return {}

  const all = fieldErrors(join.draft)
  const mine: Partial<Record<FieldName, string>> = {}
  for (const field of STEP_FIELDS[step]) {
    if (all[field] !== undefined) mine[field] = all[field]
  }
  return mine
}

/**
 * The furthest screen the draft has earned. Skipping ahead lands here instead,
 * so nobody reaches the dues screen with no account details behind it.
 */
export function firstIncompleteStep(): StepName {
  const errors = fieldErrors(join.draft)
  for (const step of EDITABLE_STEPS) {
    if (STEP_FIELDS[step].some((field) => errors[field] !== undefined)) return step
  }
  return 'tier'
}

/** True when the screen is filled in well enough to move on. */
export function leaveStep(step: StepName): boolean {
  join.attempted[step] = true
  return Object.keys(errorsOn(step)).length === 0
}

// The API answers 409 when better-auth already holds that email address.
const EMAIL_ALREADY_REGISTERED = 409

function describeFailure(error: ApiError): JoinFailure {
  if (error.status === EMAIL_ALREADY_REGISTERED) {
    return {
      message:
        'There is already an account for that email address, and nothing was created. ' +
        'Sign in with it, or reset the password if you have forgotten it.',
      offerSignIn: true,
    }
  }
  return { message: error.message, offerSignIn: false }
}

/**
 * The one write this app makes. Everything the five screens collected goes in
 * a single POST, so a person who gives up halfway leaves nothing behind.
 */
export async function submitJoin(client: ApiClient): Promise<boolean> {
  const parsed = signupRequest.safeParse(payloadFrom(join.draft))
  if (!parsed.success) {
    for (const step of EDITABLE_STEPS) join.attempted[step] = true
    return false
  }

  join.submitting = true
  join.failure = null
  try {
    join.created = await client.signup(parsed.data)
    return true
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    join.failure = describeFailure(error)
    return false
  } finally {
    join.submitting = false
  }
}

/**
 * member_level carries a dollar meaning as well as a role meaning, so a paying
 * tier is its level in dollars a month. docs/legacy-system.md, member levels.
 */
export const LOWEST_PAYING_LEVEL = 25

/** Level 0 is None. An admin records it; nobody joins asking for it. */
const LEVEL_NOT_OFFERED = 0

export interface TierChoice {
  level: SignupTier
  label: string
  dues: string
}

function tierChoice(level: SignupTier): TierChoice {
  return {
    level,
    label: memberLevelLabel(level) ?? String(level),
    dues: level >= LOWEST_PAYING_LEVEL ? `$${level} a month` : 'No dues',
  }
}

/**
 * What the dues screen offers, taken from the contract rather than retyped, so
 * a tier the API stops accepting stops being offered here.
 */
export const TIER_CHOICES: readonly TierChoice[] = (() => {
  const offered = signupTier.options
    .map((option) => option.value)
    .filter((level) => level !== LEVEL_NOT_OFFERED)
  const paying = offered.filter((level) => level >= LOWEST_PAYING_LEVEL).sort((a, b) => a - b)
  const unpaid = offered.filter((level) => level < LOWEST_PAYING_LEVEL).sort((a, b) => a - b)
  return [...paying, ...unpaid].map(tierChoice)
})()
