# 0004. Keep the bcrypt hashes and upgrade them on sign in

Date: 2026-09-11
Status: accepted

## Context

The production database holds 1,030 bcrypt hashes at cost 10 with the `$2a$`
prefix, written by Devise, and 31 empty values. Argon2id is what this system
would choose today.

## Alternatives

| Option | Why not |
| --- | --- |
| Reset every password at cutover | A thousand people get an email asking them to do something, on the day the new system arrives. The ones who do not read it cannot get in, and the ones who do are trained that a password reset email from the lab is normal. |
| Keep bcrypt forever | Cost 10 is below where it should be, and the dependency stays. |
| Rehash on import | Impossible. A hash cannot be converted without the password. |

## Decision

Import the hashes verbatim. On the first successful sign-in, verify with bcrypt
and immediately replace the stored hash with Argon2id, in the same request.
Nobody resets anything and nobody notices.

`PEPPER` defaults to the empty string, which reduces this to plain bcrypt at no
cost. It exists so that a pepper found later in the legacy configuration is a
config change rather than a forced reset for a thousand people.

## Consequence

Easy: cutover changes nothing anybody has to do. The migration completes itself.

Hard: `bcryptjs` stays installed until the counter in `scripts/nightly.sql`
reaches zero, and some accounts will never sign in again, so it will not reach
zero on its own. At some point somebody decides the remainder are dormant and
clears them.

Flip condition: the count stops falling for a year, or a reason appears to
distrust the legacy hashes rather than merely their cost.
