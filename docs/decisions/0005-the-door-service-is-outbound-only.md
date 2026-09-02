# 0005. The door service reaches out, nothing reaches in

Date: 2026-09-01
Status: accepted

## Context

The door service runs on the lab LAN because it is the only thing allowed to talk
to the controller, and the controller has no public address. The public host runs
the API. The two have to exchange commands and status.

The hard requirement is that physical cards open the door when everything in this
repository is down.

## Alternatives

| Option | Why not |
|---|---|
| WireGuard | No third party, but two config files that must agree, a `PersistentKeepalive` the NAT-side peer needs in order to receive anything, and failures that are silent and directional. A volunteer at 2am has to know what `wg show` means before they can start. |
| Tailscale | By far the easiest to stand up, and the right answer for letting humans reach the lab. As the path the door depends on it adds a SaaS control plane and a default 180 day key expiry, which is a time bomb set for roughly six months after whoever configured it has moved on. |
| Open a port to the lab | A public inbound path to the network segment holding an unauthenticated HTTP door controller. |

## Decision

The door service makes outbound HTTPS connections to the API and accepts no
inbound connection. It holds a subscription for commands and posts status and
events back. It keeps its own copy of the card table so it can reconcile the
controller without asking anyone.

The API serves `/space_api.json` from the status the door service last posted,
which removes the tunnel from the public status path entirely.

## Consequence

Easy: nothing to configure at either end beyond a URL and a token. No firewall
rule, no NAT traversal, no third party. A volunteer debugs it with
`docker compose logs -f door` and one `curl` from the lab.

Hard: when the link is down the card table goes stale, and the door keeps opening
for everyone already provisioned. That is the correct failure: the building stays
usable and the fix is not urgent. Remote control returns 503 honestly.

Status is as fresh as the last post, so the public indicator can lag by one
interval. The legacy system had the same property.

Flip condition: volunteers need to reach the lab host itself, at which point add
Tailscale for people and disable key expiry on that node, as an operator
convenience and never as the path the door's own function depends on.
