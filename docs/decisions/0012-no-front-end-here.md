# 0012. No front end in this repository

Date: 2026-09-11
Status: accepted

## Context

The previous attempt held three applications, two shared packages and a design
system alongside the API, and a change to a response shape touched five
directories. None of the three applications ever ran against real data.

Members need screens. Something has to render them.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the applications here | The API is the thing the building depends on, and it should be reviewable, deployable and reasonable about on its own. |
| Server-rendered pages in the API | The API gains a template engine, a static file story and a view layer, and the cookie stops being the only thing a front end needs. |
| No front end at all | Not viable. Members sign up, edit a profile and read the door log. |

## Decision

This repository ends at the HTTP boundary. Front ends live in their own
repositories and are consumers like any other: same-origin behind one Caddy, one
session cookie scoped to the apex domain, no CORS and no configuration.

The cookie is deliberately apex-scoped so that a new application on a subdomain
needs no integration work at all.

## Consequence

Easy: this repository is two processes and about 2,500 lines. A front end can be
rewritten, replaced or abandoned without touching the thing that opens the door.

Hard: there is no screen for anything yet, including enrolling a card that the
door reported as presented and undoing a signup. The API answers, and somebody
has to build the page. `HANDOFF.md` says so plainly rather than implying a
system that is finished.

Flip condition: none foreseen. A front end joining this repository would be a
reversal of the reason this rewrite exists.
