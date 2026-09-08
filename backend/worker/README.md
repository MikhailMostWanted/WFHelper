# Backend Worker

Cloudflare Worker cache for the Warframe Market data used by WFHelper. Runtime details and
invariants are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Endpoints

Public:

- `GET /healthz`
- `GET /v1/bootstrap`
- `GET /v1/snapshot`
- `GET /v1/prices/:slug`
- `GET /v1/meta/:slug`
- `GET /v1/order-summary/:slug`, with `?subtype=` for relic refinements
- `GET /v1/supporters`
- `GET /v1/baro-history`, recorded visits, last-seen dates and nullable historical prices
- `POST /v1/feedback`, anonymous bug reports and feature requests
- `GET /v1/orders/:slug`, disabled by default

Admin routes require `Authorization: Bearer <ADMIN_API_KEY>`:

- `POST /admin/prewarm`
- `GET /admin/prewarm/status`
- `POST /admin/order-summary-hotset`
- `GET /admin/order-summary-hotset`
- `GET /admin/order-summary-catalog`
- `POST /admin/prewarm/order-summaries`
- `GET /admin/prewarm/order-summaries/status`
- `GET /admin/snapshot/status`
- `POST /admin/patreon/exclusions`
- `POST /admin/patreon/sync`

## Automatic flow

1. The desktop loads the bulk snapshot at startup.
2. Per-item requests check KV first.
3. Fresh cache entries return immediately.
4. Stale entries return while a refresh runs through `waitUntil`.
5. Cache misses fetch Warframe Market and write back to KV.
6. Confirmed misses and untradable items receive short-lived markers.
7. Cron walks the catalog and refreshes entries outside the 21-hour freshness window.
8. Each batch patches the bulk snapshot through a Durable Object coordinator.

Prewarm cron runs every 15 minutes. Production batches currently process 125 catalog items and 36
ranked summary entries per tick, then advance one batch of the riven history sweep. A separate daily
trigger runs the Discord supporter sync and writes the daily price and Baro archives. Manual prewarm
remains an operator tool, not a correctness requirement.

History archives accrue from deploy day. The price seed can recover available WFM statistics;
Baro history can recover only visit archives this Worker still retains. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for their keys, cadence, and retention.

### Baro history

The daily archive stage maintains `ITEM_META` key `baro:history:v1` without a TTL. Its migration
runs even when Baro is inactive and reads up to 128 retained visit archives. Visit details follow
`HISTORY_RETENTION_DAYS` and a 128-visit bound, while up to 5,000 item last-seen records survive
visit removal. Raw manifests are stored before durable reconciliation; unknown missing or failed archive reads are retried daily and block index pruning. A bounded acknowledgement ledger lets already-materialized archives expire without blocking later cron runs. Corrupt durable data is backed up to `baro:history:recovery:v1` before recoverable dates are salvaged. Persistent migration errors need operator investigation. Coverage is partial; an absent item or visit is unknown, not proof it never appeared.

`GET /v1/baro-history` is public without bootstrap and uses the existing snapshot rate limiter (2/minute per IP). Valid
history is edge-cached for one hour; an empty history for five minutes. Invalid durable data returns 503. The endpoint reads only the materialized key and supports ETag/304; it never reconstructs archives, fetches upstream history or writes KV. Missing history also returns 503 until the daily stage materializes it. No new binding or secret is needed.

New version 2 archives use inventory item paths and keep missing ducat/credit costs as `null`.
Migration reads version 1 too, treating legacy zeros as unknown because they may represent missing
prices. Explicit zeros in version 2 stay zero. Dates reflect recorded visits, not predictions.

Keep the existing daily cron as the only history writer. Its local queue does not provide atomic
updates across Worker isolates; adding another writer requires coordination. Do not delete the
durable key as routine cache cleanup because its last-seen records can outlive the source archives.

## Configuration

KV bindings:

- `PRICE_CACHE`
- `ITEM_META`

Durable Object bindings:

- `DAILY_BUDGET`
- `SNAPSHOT_COORDINATOR`

Rate Limiting bindings:

- `PUBLIC_HEALTH_RATE_LIMITER`
- `PUBLIC_LOW_RATE_LIMITER`
- `PUBLIC_API_RATE_LIMITER`
- `PUBLIC_SNAPSHOT_RATE_LIMITER`
- `ADMIN_RATE_LIMITER`
- `FEEDBACK_RATE_LIMITER`, required for feedback, 2 requests per minute per IP
- `FEEDBACK_GLOBAL_LIMITER`, required for feedback, 10 requests per minute across all senders

## Private Discord feedback

Create a dedicated private feedback channel and a webhook for that channel in Discord.
Keep its URL out of the desktop app, source files, build variables, and chat messages.
Set it as the Worker secret `FEEDBACK_DISCORD_WEBHOOK_URL` using the Cloudflare dashboard
or `npx wrangler secret put FEEDBACK_DISCORD_WEBHOOK_URL` from this directory. Use the
unmodified `https://discord.com/api/webhooks/<id>/<token>` URL without query parameters.
Deploy the Worker with the `FEEDBACK_RATE_LIMITER` and `FEEDBACK_GLOBAL_LIMITER` bindings before
releasing the desktop UI.
For a forum channel keep the var `FEEDBACK_DISCORD_FORUM` at `1` in `wrangler.jsonc`: each report
then opens its own thread named after its kind and title. Remove the var for a text channel,
where Discord rejects thread names.
No Discord bot or user login is required. The endpoint returns unavailable until both the
secret and limiter are configured. Rotate the webhook in Discord and replace the secret if
it leaks. Tests mock delivery and never send feedback to the channel.

Reports include the user-entered category, title, description, optional contact, app version
and platform. Diagnostics and one screenshot are opt-in. The modal previews the screenshot
and lists the diagnostic fields and log size; it does not preview the log contents.
Diagnostics contain OS version, architecture, language, current view, UI scale and the last
256 KiB of `main.log`, which can contain file paths, account and player names, and technical events.
The desktop re-encodes screenshot pixels to discard the original file's embedded metadata.
The relay reads no separate account, inventory or machine-identifier files. The log is sent
as recorded and is not redacted by the feedback relay.
Screenshots and free text can contain personal information; restrict channel membership and
delete reports when they are no longer needed. Discord retains the messages until deleted;
the Worker does not store feedback in KV or print report content in its request logs.

The endpoint enforces a streamed 2,000,000-byte JSON limit, a 256 KiB log tail and a 1 MiB PNG/JPEG/WebP attachment
limit. It keeps the webhook server-side, disables mentions, and sends once with Discord's
`wait=true` acknowledgement. A timeout can mean delivery succeeded without an acknowledgement;
there is no automatic retry. The independent feedback limiter fails closed even when public
market-data rate limiting is disabled. Shared daily-budget and CORS checks still apply.

Important variables:

- `CACHE_TTL_SEC`
- `ORDERS_SUMMARY_CACHE_TTL_SEC`
- `ORDERS_SUMMARY_STALE_REFRESH_SEC`
- `NO_DATA_TTL_SEC`
- `STALE_REFRESH_SEC`
- `ALLOW_ORIGIN`
- `CATALOG_SLUG_GUARD_ENABLED`
- `DAILY_BUDGET_ENABLED`
- `DAILY_BUDGET_MAX_REQUESTS`
- `DAILY_BUDGET_SAMPLE_RATE`
- `PREWARM_BATCH_SIZE`
- `ORDER_SUMMARY_PREWARM_BATCH_SIZE`
- `CATALOG_REFRESH_HOURS`
- `ADMIN_PREWARM_MAX_BATCH`
- `PUBLIC_RATE_LIMIT_ENABLED`
- `HISTORY_ARCHIVE_ENABLED`
- `HISTORY_RETENTION_DAYS`
- `RIVEN_ARCHIVE_BATCH_SIZE`
- `PUBLIC_BOOTSTRAP_REQUIRED`
- `BOOTSTRAP_TOKEN_TTL_SEC`
- `PATREON_CAMPAIGN_ID`
- `PATREON_CLIENT_ID`
- `PATREON_TIER_MAP`

Secrets:

- `ADMIN_API_KEY`
- `BOOTSTRAP_TOKEN_SECRET`
- `PATREON_CLIENT_SECRET`
- `PATREON_ACCESS_TOKEN`
- `PATREON_REFRESH_TOKEN`

Production values and binding identifiers live in `wrangler.jsonc`.

## Setup

From this directory:

```bash
npm ci
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put BOOTSTRAP_TOKEN_SECRET
npm run cf-typegen
npm run typecheck
npm run test -- --run
```

The separate Worker package intentionally uses npm. Repository-root desktop commands use pnpm.

## Run and deploy

```bash
npm run dev
npm run deploy
```

`npm run deploy` targets the top-level production configuration. Local development uses the named
`dev` environment and its localhost CORS origin.

Recommended dashboard controls:

- A custom-domain WAF rate limit before Worker execution.
- A stricter `/admin` rate limit and, where practical, an admin source-IP allowlist.
- Billing alerts appropriate to the account budget.

## Manual prewarm

From the repository root:

```powershell
pnpm run backend:prewarm:order-summaries -- -ApiKey "<ADMIN_API_KEY>" -RefreshCatalog
pnpm run backend:prewarm:order-summaries:hotset -- -ApiKey "<ADMIN_API_KEY>"
```

The hotset helper reads `ranked-hotset.json`, uploads it, resets the summary cursor, and loops until
the selected entries are warm.

## Live smoke test

```bash
WORKER_URL=https://api.wfhelper.com npm run test:smoke
```

GitHub Actions runs the same test against production every six hours. Keep it out of pull-request
CI because it depends on live upstream and deployment state.
