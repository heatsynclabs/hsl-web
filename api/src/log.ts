/**
 * One JSON object per line on stdout, collected by Docker with a size limit set.
 *
 * Passwords, session tokens, service token secrets and placements never appear
 * here. Card ids do: door_events is the debugging tool for the door.
 */
export function log(entry: { evt: string } & Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}
