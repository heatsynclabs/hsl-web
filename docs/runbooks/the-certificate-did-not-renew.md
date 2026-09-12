# The certificate did not renew

Symptom: browsers say the certificate expired, or expires soon. Caddy renews at
two thirds of the lifetime, so a certificate that is close to expiry means
renewal has been failing for weeks.

The API is fine. This is the layer in front of it.

## 1. Read Caddy's log

```sh
docker compose logs --tail 50 caddy
```

The ACME failure is in there with a reason. Most of them are one of the next
three steps.

## 2. Can the world reach port 80

ACME's HTTP challenge needs it. A firewall rule added for something else is the
usual cause.

```sh
curl -sS -o /dev/null -w '%{http_code}\n' http://api.heatsynclabs.org/healthz
```

Expect a redirect or a 200. A timeout means port 80 is closed from outside, and
no amount of restarting Caddy will fix that.

## 3. Does DNS still point here

```sh
dig +short api.heatsynclabs.org
```

Expect the public host's address. A record moved to a proxy that terminates TLS
itself will make Caddy fail forever while the site appears to work.

## 4. Is the volume still there

`caddy_data` holds the certificate and the ACME account key. If the volume was
recreated, Caddy is asking for a new certificate as a new account, which hits
rate limits rather than failing outright.

```sh
docker volume inspect hsl-web_caddy
docker compose exec caddy ls /data/caddy/certificates
```

## 5. Force a renewal

```sh
docker compose restart caddy
docker compose logs -f caddy
```

Watch for `certificate obtained successfully`. If the log says rate limited, Let
me Encrypt allows five failures per hour and five duplicate certificates per
week. Wait it out rather than restarting in a loop, which is what turns an
outage into a week-long one.

## 6. Afterwards

Back the volume up. `scripts/backup.sh` includes it. Losing it costs a new
certificate, which is an inconvenience unless it happens during a rate limit.

Caddy issues certificates with no ACME account email, which means no expiry
warnings arrive by mail. If the lab wants them, add
`{ email someone@heatsynclabs.org }` to the `Caddyfile` as its own change. An
`email` directive that resolves to an empty string stops the whole server from
parsing its config, which is why it is not there with a variable in it.
