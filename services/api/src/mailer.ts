import { createTransport } from 'nodemailer'

import type { Config } from './config.ts'

/**
 * Mail, for the one thing that needs it: password reset.
 *
 * Thirty-one imported members have an empty password hash and have never been
 * able to sign in. Reset is the only way in for them, and for anyone who
 * forgets. Without a working transport those people are locked out, so the API
 * refuses to start in production when SMTP is not configured rather than
 * discovering it the first time somebody asks for a link.
 */

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>
}

/**
 * Writes the message to the log instead of sending it. Development only, and it
 * prints the reset link so a developer can follow it.
 */
export function loggingMailer(): Mailer {
  return {
    send: async ({ to, subject, text }) => {
      console.log(`[mail] not sent, no SMTP configured\n  to: ${to}\n  subject: ${subject}\n${text}`)
    },
  }
}

export function smtpMailer(config: Config): Mailer {
  if (config.smtpUrl === null) {
    throw new Error('smtpMailer needs SMTP_URL. Call loggingMailer when it is unset.')
  }

  const transport = createTransport(config.smtpUrl)

  return {
    send: async ({ to, subject, text }) => {
      await transport.sendMail({ from: config.mailFrom, to, subject, text })
    },
  }
}

export function createMailer(config: Config): Mailer {
  return config.smtpUrl === null ? loggingMailer() : smtpMailer(config)
}

/**
 * The reset message. Plain text, because a member reading it on a phone in the
 * lab does not need anything else, and because a plain body cannot carry a
 * tracking pixel or a mismatched link.
 */
export function resetPasswordMessage(url: string): { subject: string; text: string } {
  return {
    subject: 'Reset your HeatSync Labs password',
    text: [
      'Somebody asked to reset the password on your HeatSync Labs account.',
      '',
      'Open this link to choose a new one:',
      url,
      '',
      'The link works once and expires in an hour.',
      '',
      'If this was not you, nothing has changed and you can ignore this message.',
    ].join('\n'),
  }
}
