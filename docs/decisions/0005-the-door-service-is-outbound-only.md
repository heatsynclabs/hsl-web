# 0005. The door service is outbound only

Date: 2026-09-11
Status: accepted

## Context

The door controller is on the lab VLAN, speaks plain HTTP with a four hex
character password in the query string, and has no authentication worth the
name. The API is on a public host. Something has to cross between them.

## Alternatives

| Option | Why not |
| --- | --- |
| Open an inbound port to the lab | A public path to a network segment holding an unauthenticated door controller. The switch is the real access boundary until that controller is replaced. |
| A tunnel, such as WireGuard | Two configurations that must agree, fail silently, and fail directionally. When it breaks at 2am it breaks for somebody who did not set it up. |
| A mesh with a control plane | A third party in the path to the building's door, and a key expiry set to fire six months after whoever configured it has moved on. |

## Decision

The door service makes outbound HTTPS calls to the API and accepts none. Its
only listener is a health check bound to localhost. Six endpoints under `/door`,
authenticated with a service token holding one scope.

## Consequence

Easy: nothing on the public internet can reach the lab network. The lab host
needs no inbound firewall rule, no certificate and no DNS name. A compromised
controller holds a credential that can do one thing.

Hard: a command waits up to one tick, five seconds, before it runs. The API
expires anything that waited more than two minutes and records that it never
ran, so an admin sees a command asked for and not executed rather than finding
it silently missing.

Flip condition: a command latency of five seconds becomes a real complaint,
which would argue for a long poll rather than for an inbound port.
