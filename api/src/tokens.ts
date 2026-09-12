import { exportJWK, generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose'
import type { JWK } from 'jose'

import { config } from './config.ts'
import { log } from './log.ts'

const ALGORITHM = 'RS256'
const LIFETIME = '1h'

/**
 * Rotation is publishing both keys under different kid values, signing with the
 * new one, and dropping the old after an hour. Nothing here changes for that
 * beyond returning two entries from publicKeys().
 */
const KEY_ID = 'hsl-1'

/** Whatever jose hands back. Naming it avoids depending on a global type. */
type Key = Awaited<ReturnType<typeof importPKCS8>>

interface Keys {
  privateKey: Key
  publicKey: Key
  jwks: { keys: JWK[] }
}

let keys: Promise<Keys> | null = null

/** Compose hands PEM through with escaped newlines often enough to handle both. */
function pem(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value
}

async function load(): Promise<Keys> {
  const secret = config.signingKey
  const published = config.signingKeyPublic

  let pair: { privateKey: Key; publicKey: Key }
  if (secret !== null && published !== null) {
    pair = {
      privateKey: await importPKCS8(pem(secret), ALGORITHM),
      publicKey: await importSPKI(pem(published), ALGORITHM, { extractable: true }),
    }
  } else {
    // config.ts refuses to start without a key on https, so this is a laptop.
    pair = await generateKeyPair(ALGORITHM, { extractable: true })
    log({ evt: 'signing_key_generated', note: 'no SIGNING_KEY set, tokens stop verifying at restart' })
  }

  const jwk = await exportJWK(pair.publicKey)
  return {
    ...pair,
    jwks: { keys: [{ ...jwk, kid: KEY_ID, alg: ALGORITHM, use: 'sig' }] },
  }
}

function loaded(): Promise<Keys> {
  keys ??= load()
  return keys
}

export interface TokenSubject {
  id: string
  name: string
  roles: string[]
}

/** One hour, no refresh. The client holds the session cookie and asks again. */
export async function issueToken(member: TokenSubject): Promise<string> {
  const { privateKey } = await loaded()
  return new SignJWT({ name: member.name, roles: member.roles })
    .setProtectedHeader({ alg: ALGORITHM, kid: KEY_ID })
    .setIssuer(config.issuer)
    .setSubject(member.id)
    .setIssuedAt()
    .setExpirationTime(LIFETIME)
    .sign(privateKey)
}

export async function publicKeys(): Promise<{ keys: JWK[] }> {
  return (await loaded()).jwks
}

/**
 * The member id a token names, or null.
 *
 * Only the subject is trusted. Roles and status are read from the member row on
 * every request, so a suspension takes effect before the hour is up.
 */
export async function subjectOf(token: string): Promise<string | null> {
  try {
    const { publicKey } = await loaded()
    const { payload } = await jwtVerify(token, publicKey, { issuer: config.issuer })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}
