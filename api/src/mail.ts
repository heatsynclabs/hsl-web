import { createTransport } from 'nodemailer'

import { config } from './config.ts'
import { log } from './log.ts'

/** Null on a laptop. config.ts refuses to start without SMTP_URL on https. */
const transport = config.smtpUrl === null ? null : createTransport(config.smtpUrl)

const BODY = (link: string): string =>
  [
    'Somebody asked to set the password on your HeatSync Labs account.',
    '',
    link,
    '',
    'The link works once and stops working in an hour. If this was not you,',
    'nothing has changed and you can ignore this.',
  ].join('\n')

/**
 * Never rejects. Callers do not wait for it, so a rejection here would be an
 * unhandled one, and a mail server that is down is an operational problem to
 * read in the log rather than something a member should meet as an error.
 */
export async function sendResetLink(to: string, token: string): Promise<void> {
  const link = `${config.resetUrl}?token=${token}`

  if (transport === null) {
    // A laptop with no SMTP. The link goes to the log so development works.
    log({ evt: 'mail_not_sent', to, link })
    return
  }

  try {
    await transport.sendMail({
      from: config.mailFrom,
      to,
      subject: 'Set your HeatSync Labs password',
      text: BODY(link),
    })
  } catch (error) {
    log({ evt: 'mail_failed', to, message: String(error) })
  }
}
