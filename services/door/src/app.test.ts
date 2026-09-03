import { describe, expect, it } from 'vitest'

import { createArduinoController } from './adapters/openaccess-arduino/controller.ts'
import { createFakeDevice, type FakeDevice } from './adapters/fake/device.ts'
import { createApp } from './app.ts'

const PASSWORD = '1234'
const TOKEN = 'door-token-for-tests'

function lab(): { app: ReturnType<typeof createApp>; device: FakeDevice } {
  const device = createFakeDevice({ password: PASSWORD })
  const controller = createArduinoController({ password: PASSWORD, transport: device.transport })
  return { app: createApp({ controller, doorToken: TOKEN }), device }
}

function control(command: string): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  }
}

describe('healthz', () => {
  it('answers without a token, because the compose healthcheck reads it', async () => {
    const response = await lab().app.request('/healthz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'door' })
  })
})

describe('who may drive the door', () => {
  it('refuses a request with no door token', async () => {
    const { app, device } = lab()
    const response = await app.request('/control', {
      method: 'POST',
      body: JSON.stringify({ command: 'open-front' }),
    })
    expect(response.status).toBe(401)
    expect(device.pulses).toEqual([])
  })

  it('refuses a request with the wrong door token', async () => {
    const { app, device } = lab()
    const response = await app.request('/control', {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-token' },
      body: JSON.stringify({ command: 'open-front' }),
    })
    expect(response.status).toBe(401)
    expect(device.pulses).toEqual([])
  })

  it('refuses to report status without the door token', async () => {
    expect((await lab().app.request('/status')).status).toBe(401)
  })
})

describe('the rear door stays locked', () => {
  it('refuses unlock-rear by the lab decision of 2018-02-22 and sends nothing', async () => {
    const { app, device } = lab()
    const response = await app.request('/control', control('unlock-rear'))

    expect(response.status).toBe(403)
    expect((await response.json() as { error: string }).error).toMatch(/2018-02-22/)
    expect(device.rearLocked).toBe(true)
    expect(device.requests).toEqual([])
  })

  it('still pulses the rear strike, which is what open-rear is for', async () => {
    const { app, device } = lab()
    expect((await app.request('/control', control('open-rear'))).status).toBe(200)
    expect(device.pulses).toEqual([2])
  })

  it('still unlocks the front door', async () => {
    const { app, device } = lab()
    expect((await app.request('/control', control('unlock-front'))).status).toBe(200)
    expect(device.frontLocked).toBe(false)
    expect(device.rearLocked).toBe(true)
  })
})

describe('driving the door', () => {
  it('pulses the front strike', async () => {
    const { app, device } = lab()
    const response = await app.request('/control', control('open-front'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ command: 'open-front' })
    expect(device.pulses).toEqual([1])
  })

  it('locks both doors and arms the alarm', async () => {
    const { app, device } = lab()
    await app.request('/control', control('unlock'))
    await app.request('/control', control('lock'))
    await app.request('/control', control('arm'))

    expect(device.frontLocked).toBe(true)
    expect(device.rearLocked).toBe(true)
    // armAlarm(1), firmware 518. The board does not use 255 for armed; that is
    // only what an uncommissioned EEPROM reads back at boot.
    expect(device.armed).toBe(1)
  })

  it('refuses something that is not a door command', async () => {
    const { app, device } = lab()
    const response = await app.request('/control', control('open-the-roof'))
    expect(response.status).toBe(400)
    expect(device.requests).toEqual([])
  })

  it('reports the status the controller gives', async () => {
    const { app, device } = lab()
    device.frontLocked = false

    const response = await app.request('/status', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: { frontLocked: false, rearLocked: true, armed: 255 },
    })
  })

  it('answers 503 when the controller cannot be reached, rather than pretending', async () => {
    const device = createFakeDevice({ password: PASSWORD })
    const controller = createArduinoController({ password: 'wrong', transport: device.transport })
    const app = createApp({ controller, doorToken: TOKEN })

    const response = await app.request('/status', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(503)
  })
})
