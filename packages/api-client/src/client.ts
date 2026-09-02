import type { z } from 'zod'

import {
  auditResponse,
  cardResponse,
  certificationsResponse,
  cardTableViewResponse,
  doorControlResponse,
  doorEventsResponse,
  syncResponse,
  unknownCardsResponse,
  doorStatusResponse,
  memberCertificationsResponse,
  memberResponse,
  membersResponse,
  meResponse,
  paymentResponse,
  signupResponse,
  spaceApiResponse,
} from '@hsl/schema'
import type {
  AuditQuery,
  DoorControlRequest,
  GrantCertificationRequest,
  PatchCardRequest,
  PatchMemberRequest,
  PatchMeRequest,
  PostCardRequest,
  PostPaymentRequest,
  SignupRequest,
} from '@hsl/schema'

import { ApiError } from './errors.ts'

/**
 * One method per row of the route table in docs/architecture.md. Every method
 * sends the session cookie and parses the answer with the schema the API
 * validated it against, so a route that changes shape fails loudly here instead
 * of putting a half filled member on a screen.
 *
 * Sign in, sign out and password reset are not here. Those are the better-auth
 * routes under /api/auth, and better-auth ships its own client for them.
 */

export interface ClientOptions {
  /** Where the API lives. Caddy serves the apps and the API on one origin, so this is often ''. */
  baseUrl: string
  /** For tests, and for anything that carries its own cookie jar. */
  fetch?: typeof globalThis.fetch
}

interface Call<Schema extends z.ZodType> {
  method: string
  path: string
  schema: Schema
  body?: unknown
}

async function fetchOrThrow(options: ClientOptions, call: Call<z.ZodType>): Promise<Response> {
  const http = options.fetch ?? globalThis.fetch
  const sending = call.body !== undefined

  try {
    return await http(options.baseUrl + call.path, {
      method: call.method,
      credentials: 'include',
      headers: sending ? { 'content-type': 'application/json' } : undefined,
      body: sending ? JSON.stringify(call.body) : undefined,
    })
  } catch (cause) {
    throw ApiError.unreachable({ method: call.method, path: call.path, cause })
  }
}

/** Caddy and the browser both send plain text on a bad day, so a non JSON body is kept as text. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function request<Schema extends z.ZodType>(
  options: ClientOptions,
  call: Call<Schema>,
): Promise<z.infer<Schema>> {
  const response = await fetchOrThrow(options, call)
  const body = await readBody(response)
  const where = { method: call.method, path: call.path, status: response.status, body }

  if (!response.ok) throw ApiError.refused(where)

  const parsed = call.schema.safeParse(body)
  if (!parsed.success) throw ApiError.malformed({ ...where, issues: parsed.error })

  return parsed.data
}

function memberPath(memberId: string): string {
  return `/api/members/${encodeURIComponent(memberId)}`
}

function auditPath(query: Partial<AuditQuery>): string {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.before !== undefined) params.set('before', String(query.before))

  const search = params.toString()
  return search === '' ? '/api/audit' : `/api/audit?${search}`
}

type CallFn = <Schema extends z.ZodType>(spec: Call<Schema>) => Promise<z.infer<Schema>>

/** The door screens an admin uses. Grouped so the client factory stays readable. */
function doorMethods(call: CallFn) {
  return {
    /** The enrolment queue: cards held to a reader that no card row claims. */
    unknownCards: () =>
      call({ method: 'GET', path: '/api/door/unknown-cards', schema: unknownCardsResponse }),
    /** What the controller should be holding, slot by slot. */
    cardTable: () =>
      call({ method: 'GET', path: '/api/door/card-table-view', schema: cardTableViewResponse }),
    doorEvents: () => call({ method: 'GET', path: '/api/door/events', schema: doorEventsResponse }),
    /** Ask for the card table to be pushed now rather than on the next pass. */
    syncDoor: () => call({ method: 'POST', path: '/api/door/sync', schema: syncResponse, body: {} }),
  }
}

export function createClient(options: ClientOptions) {
  const call = <Schema extends z.ZodType>(spec: Call<Schema>) => request(options, spec)

  return {
    me: () => call({ method: 'GET', path: '/api/me', schema: meResponse }),
    updateMe: (changes: PatchMeRequest) =>
      call({ method: 'PATCH', path: '/api/me', schema: meResponse, body: changes }),
    signup: (application: SignupRequest) =>
      call({ method: 'POST', path: '/api/signup', schema: signupResponse, body: application }),
    members: () => call({ method: 'GET', path: '/api/members', schema: membersResponse }),
    member: (memberId: string) =>
      call({ method: 'GET', path: memberPath(memberId), schema: memberResponse }),
    updateMember: (memberId: string, changes: PatchMemberRequest) =>
      call({ method: 'PATCH', path: memberPath(memberId), schema: memberResponse, body: changes }),
    assignCard: (card: PostCardRequest) =>
      call({ method: 'POST', path: '/api/cards', schema: cardResponse, body: card }),
    updateCard: (slot: number, changes: PatchCardRequest) =>
      call({ method: 'PATCH', path: `/api/cards/${slot}`, schema: cardResponse, body: changes }),
    certifications: () =>
      call({ method: 'GET', path: '/api/certifications', schema: certificationsResponse }),
    grantCertification: (memberId: string, grant: GrantCertificationRequest) =>
      call({
        method: 'POST',
        path: `${memberPath(memberId)}/certifications`,
        schema: memberCertificationsResponse,
        body: grant,
      }),
    revokeCertification: (memberId: string, slug: string) =>
      call({
        method: 'DELETE',
        path: `${memberPath(memberId)}/certifications/${encodeURIComponent(slug)}`,
        schema: memberCertificationsResponse,
      }),
    recordPayment: (payment: PostPaymentRequest) =>
      call({ method: 'POST', path: '/api/payments', schema: paymentResponse, body: payment }),
    auditLog: (query: Partial<AuditQuery> = {}) =>
      call({ method: 'GET', path: auditPath(query), schema: auditResponse }),
    ...doorMethods(call),
    controlDoor: (command: DoorControlRequest) =>
      call({
        method: 'POST',
        path: '/api/door/control',
        schema: doorControlResponse,
        body: command,
      }),
    doorStatus: () => call({ method: 'GET', path: '/api/door/status', schema: doorStatusResponse }),
    spaceApi: () => call({ method: 'GET', path: '/space_api.json', schema: spaceApiResponse }),
  }
}

export type ApiClient = ReturnType<typeof createClient>
