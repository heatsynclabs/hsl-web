# 0004. Everyone keeps their password

Date: 2026-09-01
Status: accepted

## Context

The legacy database holds 1,030 bcrypt hashes at cost 10 with the `$2a$` prefix,
written by Devise 2.2.7 with the pepper commented out. Verified by reading the
prefix distribution out of the restored production dump.

A rewrite that forces a thousand people to reset a password is a rewrite most of
them never complete.

## Alternatives

| Option | Why not |
|---|---|
| Force a reset at cutover | A password reset email to every member, and a support burden on the admins for months. The people most likely to give up are the ones who use the door least often, which is exactly the wrong filter. |
| Rehash to scrypt on first successful sign in | I read `dist/api/routes/sign-in.mjs` in the published better-auth 1.7.2 tarball. It calls `password.verify` and goes straight to `createSession`. There is no rehash hook, so this is code we would write and own. Staying on bcrypt is a defensible posture and one fewer moving part. |

## Decision

Configure `emailAndPassword.password` with custom `hash` and `verify` backed by
bcrypt. The import copies `encrypted_password` verbatim.

```ts
password: {
  hash:   (password) => bcrypt.hash(password + LEGACY_PEPPER, 10),
  verify: ({ hash, password }) => bcrypt.compare(password + LEGACY_PEPPER, hash),
}
```

`LEGACY_PEPPER` defaults to the empty string, which reduces this to plain bcrypt
at no cost. It exists so that if a pepper is ever discovered in the legacy
configuration, it is an environment variable rather than a code change and a
forced reset for everyone.

## Decision, second half

The import writes an `account` row per member with `providerId: "credential"`,
`issuer: "local:credential"`, `accountId` set to the member's own id, and
`password` set to the legacy hash. The 1.7 sign-in handler filters on all three
of those fields. Getting `issuer` wrong produces a silent
`INVALID_EMAIL_OR_PASSWORD` for the entire membership, with nothing in the logs
beyond a `User not found` warning.

## Consequence

Easy: nobody resets anything. Cutover is invisible to members.

Hard: bcrypt cost 10 is the floor forever unless somebody writes the upgrade.

The 31 accounts with an empty `encrypted_password` get a member row and no
credential. They could not sign in before either, and they use password reset.

Verification is signing in as a real migrated member on staging before cutover,
not inspecting rows.

Flip condition: a bcrypt weakness that matters at cost 10, or a decision to
require passkeys.
