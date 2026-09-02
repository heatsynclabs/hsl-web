# infra

Configuration that belongs to a deployment rather than to a package.

| File | What |
|---|---|
| `Caddyfile` | The routes. Baked into the web image, not bind mounted, because the official Caddy image warns that a bind mounted config breaks graceful reload |
| `space_api.template.json` | The public status document, below |
| `door/` | The lab host's compose file and its example environment |

## space_api.template.json

The SpaceAPI 0.12 document the lab website and the ESP8266 status LED read.
It was pulled out of the production `settings` table, where Rails kept it under
`space_api_json_template` as a YAML string, and unwrapped into plain JSON. The
values are the lab's own and none of them were invented here.

The API reads it once at boot and writes two keys over it on every request:
`open` and `status`. Nothing else about the document changes.

Some values in it are stale, notably the `intranet.heatsynclabs.org` icon URLs,
the freenode IRC link and the `http://` scheme throughout. They are left exactly
as production serves them, because this file is a compatibility contract rather
than a place to tidy up. Change them when somebody decides to, as their own
commit, not as a side effect of the migration.
