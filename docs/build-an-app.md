# Build an app that signs in with a HeatSync account

Somebody wants to build a tool checkout board, a class sign up sheet, a shop
kiosk, and have members use the account they already have. This is what works
today, what does not, and what it would take.

Read this before you start, because the easy path and the hard path look similar
from the outside and they are not.

## The short version

| What you are building | What to do |
|---|---|
| A web app the lab runs | Serve it on the members hostname. It shares the session already. |
| A device, an interlock, a kiosk with no keyboard | Ask an admin for a door token. There is no self service for this yet. |
| An app on its own domain, run by somebody else | Not supported today. See the last section. |

## The easy path, which is the one to take

Every app the lab runs is served from one hostname. The members portal is at the
root, signup is at `/signup`, the admin portal is at `/admin`. They are three
separate builds and they share one session cookie, because a cookie belongs to
an origin and they are all the same origin.

An app you add is a fourth. Put it at a path, and a member who signed in to the
members portal is already signed in to yours. There is no redirect, no token
exchange, no consent screen, and nothing to configure.

Ask the API who it is:

```js
const response = await fetch('/api/me', { credentials: 'include' })

if (response.status === 401) {
  // Nobody is signed in. Send them to the members app and come back.
  location.href = `/sign-in?next=${encodeURIComponent(location.pathname)}`
} else {
  const { member, certifications, cards } = await response.json()
}
```

`credentials: 'include'` is the only part people forget. Without it the browser
sends no cookie and every request looks anonymous.

### What you get back

Read from a running system, signed in as a seeded member:

```
id             'seed-sam'
name           'Sam Rivera'
email          'sam@example.test'
memberLevel    50
cardAccess     true
orientation    '2025-03-14T00:00:00.000Z'
admin          false
instructor     false
accountant     false
certifications ['laser', 'tablesaw']
cards          [41]
```

That is enough to answer the questions an app in a workshop actually asks. Is
this person a member. Have they been oriented. Are they certified on the laser
cutter. Do they hold a card.

### Adding your app to the stack

One block in `infra/Caddyfile`, next to the ones already there:

```
handle_path /toolboard* {
    import spa /srv/toolboard
}
```

and one line in `apps/Dockerfile` copying your build into `/srv/toolboard`. If
you build with Vite, set `base: '/toolboard/'` so the asset URLs carry the
prefix, the way `apps/admin/vite.config.ts` does.

### What the API will not let you do

The session is the member's, not your app's, so your app can do exactly what
that member can do and nothing more. A member cannot read another member's phone
number through your app any more than they can through the members portal. The
refusal comes from the API, so there is no way to get it wrong in your code.

If your app needs to read the directory, the member using it has to be oriented.
If it needs to change somebody, they have to be an admin.

## Devices, interlocks and kiosks

A machine has no browser and no member sitting at it. The pattern for those is a
shared credential, which is how the door service authenticates: one token in an
environment variable, sent as a header, checked in constant time.

There is one such credential today and it belongs to the door service. Adding a
second is a small change to `services/api/src/routes/door.ts` and a config value,
but it has not been done, and it should not be done casually: a token that can
ask whether a card is valid is a token worth stealing.

If you are building an interlock, say so before you build it. The shape it wants
is one endpoint that answers "may this card use this tool", and the data is
already there: `cards`, `user_certifications` and `cardAccess`. It is an
afternoon of work and an ADR, not a research project. It is deliberately not
built yet because nothing has asked for it.

## An app on another domain

Not supported, on purpose.

Signing in from another origin means being an OAuth or OIDC provider. better-auth
has a plugin for it. It is not turned on, and the reasoning is written down: that
plugin has accumulated six security advisories including a critical one and two
CVEs, it needs the JWT plugin alongside it, and it carries about twenty
configuration options. For a lab whose apps all run on one hostname, that is a
large attack surface bought for nothing.

The condition that would change it: something outside the lab's own hosting needs
to sign members in. A forum, a wiki, a booking service somebody else runs. When
that arrives, turning it on is a plugin, an ADR recording the decision, and a
consent screen. The mockups already drew that screen, so the design exists.

Until then, if you want members to sign in to your thing, run it on the lab's
hostname and take the easy path.

## Things that will waste your afternoon

- **Forgetting `credentials: 'include'`.** Every request looks anonymous and you
  will suspect the session is broken.
- **Running your app on a different port in development.** `localhost:5173` and
  `localhost:9080` are different origins for CORS, though cookies ignore the
  port. Use Vite's proxy, the way the three apps already do: look at
  `apps/members/vite.config.ts`.
- **Assuming the session cookie is readable from JavaScript.** It is `httpOnly`.
  You cannot see it and you do not need to.
- **Building your own login form.** Do not. Send people to the members app.
  A second form asking for a HeatSync password is the shape a phishing page has,
  and members should learn that only one place asks.
