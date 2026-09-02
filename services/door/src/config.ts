import { readFileSync } from 'node:fs'

import { z } from 'zod'

/**
 * This process is the only holder of the controller password. It reads the
 * password here, puts it in the query string of a request to the controller on
 * the lab LAN, and never sends it anywhere else. Nothing in this repository
 * outside services/door reads it, and no error message in this service prints
 * it.
 */

const settings = z.object({
  CONTROLLER_URL: z.url(),
  API_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
})

export interface DoorServiceConfig {
  /** The controller on the lab LAN, for example http://192.168.1.177 */
  controllerUrl: string
  controllerPassword: string
  /** The public members API. Reached outbound, never the other way. */
  apiUrl: string
  doorToken: string
  port: number
  reconcileIntervalSeconds: number
}

type Environment = Record<string, string | undefined>

export function loadConfig(env: Environment = process.env): DoorServiceConfig {
  const parsed = settings.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ')
    throw new Error(
      `The door service will not start: ${detail}. Nothing was sent to the controller. ` +
        'Fix infra/door/.env on the lab host and start it again.',
    )
  }

  return {
    controllerUrl: withoutTrailingSlash(parsed.data.CONTROLLER_URL),
    controllerPassword: readSecret(env, 'CONTROLLER_PASSWORD'),
    apiUrl: withoutTrailingSlash(parsed.data.API_URL),
    doorToken: readSecret(env, 'DOOR_TOKEN'),
    port: parsed.data.PORT,
    reconcileIntervalSeconds: parsed.data.RECONCILE_INTERVAL_SECONDS,
  }
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Compose mounts both secrets as files under /run/secrets, which keeps them out
 * of the process environment and out of docker inspect. The plain variable is
 * the development path. The name is reported on failure and the value never is.
 */
function readSecret(env: Environment, name: string): string {
  const path = env[`${name}_FILE`]
  const value = path === undefined || path === '' ? env[name] : readSecretFile(path, name)
  const trimmed = (value ?? '').trim()
  if (trimmed === '') {
    throw new Error(
      `${name} is unset or empty. The door service will not start without it and nothing was ` +
        `sent to the controller. Set ${name}_FILE to a file holding the value, as ` +
        'infra/door/compose.yaml does, or set ' + name + ' for development.',
    )
  }
  return trimmed
}

function readSecretFile(path: string, name: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (cause) {
    throw new Error(
      `${name}_FILE points at ${path}, which could not be read. The door service will not ` +
        'start. Check that the secret file exists on the lab host and that the container ' +
        'user can read it.',
      { cause },
    )
  }
}
