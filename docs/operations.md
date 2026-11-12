# Runtime operations

The single-host runtime supports accounts, conversations, synchronization, and optional private
media and email recovery. PostgreSQL owns durable messages, accounts, and jobs. The Worker prepares
media and delivers leased email jobs. With the calls profile enabled, the Worker also
provisions and reconciles LiveKit rooms.

## Startup and migration ordering

Create `.env` with `node scripts/create-local-env.mjs`, then run
`docker compose up --build -d --wait`. PostgreSQL becomes healthy first, the one-shot `migrate`
service initializes or upgrades its schema, and API/Worker start after migration succeeds.
Centrifugo depends on healthy Valkey. Caddy waits for API and Centrifugo before serving the
frontend. The default runtime starts with SMTP and LiveKit disabled. Without SMTP, account
capabilities explicitly disable new verification and recovery requests. Existing verified
addresses remain private account data.

For an explicit migration after rebuilding the application image:

```sh
docker compose build api worker migrate
docker compose run --rm migrate
docker compose up -d --wait api worker gateway
```

Run migrations before replacing application processes. Readiness requires the **exact embedded
migration catalogue**, including successful checksums; it deliberately does not claim compatibility
with newer schemas. Schema changes therefore require a coordinated rollout until a later milestone
introduces and tests a broader compatibility policy. Back up data before any schema change.

A failed migration returns a nonzero exit and prevents initial startup. SQLx uses transactional SQL
by default and PostgreSQL advisory locks to serialize migrators. The application closes the
dedicated migration connection even after failure, so a session lock cannot return to the pool. Fix
the cause before retrying; do not bypass a checksum mismatch or manually mark a failed migration
successful.

## Health and shutdown

`GET /health/live` reports whether the HTTP process is serving. It remains healthy when PostgreSQL
is unavailable. `GET /health/ready` checks database access and migration metadata; failure returns
HTTP 503 with a sanitized JSON error and generated `x-request-id`.

Compose uses readiness for API and Worker health. A database outage makes them unhealthy without
terminating them, and readiness recovers when the database returns. Valkey loss rejects sensitive
admission and discovery while existing authenticated reads remain available; it does not globally
fail API readiness. S3 is independent of account operations. Compose checks RustFS storage
readiness. The runtime acceptance also checks authenticated S3 reads and writes.

SIGTERM and Ctrl+C stop new HTTP acceptance, drain active requests with a deadline, and close the
connection pool with another deadline. Compose allows time for these deadlines before force-killing
containers. API and Worker log startup, draining, and stop events. Worker shutdown stops new claims
and allows bounded completion of its current SMTP attempt. A crashed claim becomes eligible for
recovery after its lease expires. Media retries also wait for cleanup of the previous candidate
so one reservation covers the bytes on disk. Only the current lease can publish a result.

## Secrets, network boundaries, and logs

Keep `.env` private and out of source control. The bootstrap script sets owner-only file
permissions. Database passwords, Centrifugo proxy/API keys, and S3 credentials are required at
Compose startup. PostgreSQL only uses its initialization password on an empty volume: changing
`.env` alone does not rotate an existing database password. Coordinate credential rotation with the
owning service.

Keep a manually changed database password URL-safe because Compose embeds it in a PostgreSQL
connection URL. Compose passes the generated S3 credentials to RustFS through its environment.

Only the frontend gateway and the media origin publish loopback host ports by default. Database,
Valkey, internal health listeners, Centrifugo administration/API, and RustFS stay inside the Compose
network. The RustFS console is disabled and Caddy blocks storage control-plane routes. The S3
credential has broad local storage access. Browsers receive scoped, expiring signatures.
Centrifugo verifies the normal session cookie through private API connect/refresh callbacks. The
browser receives a server-owned personal subscription; it cannot publish or choose arbitrary channels.
Caddy does not expose `/internal/realtime/*`. Callback authentication requires
`TG_CHAT_CENTRIFUGO_PROXY_KEY`; publication/disconnection requires the separate
`TG_CHAT_CENTRIFUGO_API_KEY`. API and Worker also use `TG_CHAT_CENTRIFUGO_URL`. Existing development
`.env` files from M3 must add the proxy key; the former token key is no longer used. Generate a fresh
secret locally with `openssl rand -hex 32` and store it privately in `.env`.
The optional Mailpit profile also publishes a loopback-only capture UI; it is a development aid.

`TG_CHAT_PUBLIC_ORIGIN` must exactly match the browser origin. Non-loopback origins require HTTPS;
the session uses a Secure `__Host-` cookie. Local loopback HTTP uses a separate non-Secure cookie.
The Compose API trusts only `X-TG-Client-IP`, which Caddy overwrites. Do not publish that API port
directly while `TG_CHAT_TRUST_GATEWAY=true`. Native services default to socket peer addresses.

Application logs contain generated request IDs, methods, matched route templates, statuses, and
elapsed time. They omit raw paths, query strings, headers, request bodies, SQL statements, and
connection credentials. Incoming request IDs are replaced instead of trusted. Dependency log filters
are disabled in Rust. Caddy filters the full request field from runtime errors, because upstream
failures otherwise include raw query strings even without access logging. Gateway connection and
response-header deadlines bound upstream failures; a stopped API can return 502 or 504. Inspect
individual dependency logs when diagnosing their failures. Do not publish resolved Compose
configuration because it contains expanded credentials.

This local stack uses HTTP and single service instances. Public hosting requires TLS, public-origin
and S3 endpoint configuration, backup/restore exercises, monitoring, and the later security and
operational milestones. This runtime does not establish high availability or public-release readiness.

## Trusted account administration

Operator commands require trusted database access. They commit their change and an append-only
audit entry together. There is no default privileged password or public bootstrap route.
Create an operator by piping a password from your secret manager into stdin:

```sh
docker compose exec -T api api operator create --username operator_one --display-name Operator
```

The command reads stdin until EOF. Supply one password line from a pipe or redirected private file.
Keep passwords out of argv and shell history. Sign in as the created identity and open
Administration in account settings. The browser checks current operator authority and recent
password proof for privileged operations.

```sh
docker compose exec -T api api operator close-registration --reason 'Maintenance window'
docker compose exec -T api api operator open-registration --reason 'Maintenance completed'
docker compose exec -T api api operator suspend --username member_one --reason 'Abuse review'
docker compose exec -T api api operator restore --username member_one --reason 'Review completed'
```

The Operator area covers registration, account suspension and restoration, reports, conversation
quarantine and restoration, account storage limits, and eligible exhausted jobs. To moderate a
private direct chat, open its accepted report case. A storage override affects new reservations.
The Reports queue opens case details with retained evidence, original downloads, and case actions.
The queue reflects case resolution after the action is accepted. If password proof is required
while reviewing reports, confirm it in the Reports view.

Suspension revokes every session and Push subscription and invalidates outstanding credential
challenges. Restoration requires a fresh login. Registration policy changes serialize with new
admissions. Audit rows identify the CLI or browser actor, target, reason, and outcome. Evidence
extensions record the previous and new deadlines. PostgreSQL rejects normal audit updates,
deletion, and truncation. Database administrators control the database boundary.

## Mail delivery and protected payloads

Configure the same SMTP sender, transport, public origin, and `TG_CHAT_MAIL_KEY` for API and Worker.
Use `starttls` or `tls` for remote SMTP; plaintext is accepted only for explicit local capture hosts.
Set both SMTP username and password when authentication is required. Invalid partial configuration
fails startup. [Development](./development.md) documents the optional Mailpit profile.

Retain the Base64-encoded 32-byte key alongside database backups using your secret-storage process.
Pending email payloads are AES-GCM encrypted and bound to their job identity. Replacing the key
does not rotate existing ciphertext: use a coordinated drain before changing it, and retain the
old key for any backup containing its pending jobs. A wrong key prevents those jobs from delivering.
Key rotation requires an operational drain and coordinated replacement.

The Worker logs job IDs and safe outcomes. Inspect job status, attempts, scheduled retry time, and
lease expiry through trusted database access when troubleshooting; avoid dumping encrypted payloads,
challenges, or recipient data into shared logs. Exhausted jobs are retained but do not count against
the pending/running queue budget. Diagnose SMTP/key failures before retrying eligible jobs
through the Operator area. An expired or invalidated challenge requires a new user request.
Terminal-row retention and cleanup require operator policy.
Successful and discarded jobs erase payload bytes. See [accounts](./accounts.md) for transaction,
single-use, and at-least-once delivery constraints.

## Web Push delivery

Set `TG_CHAT_PUSH_VAPID_PUBLIC_KEY` on API and Worker. Set
`TG_CHAT_PUSH_VAPID_PRIVATE_KEY` and `TG_CHAT_PUSH_VAPID_SUBJECT` on Worker only. Use
unpadded Base64url for the uncompressed P-256 public key and its matching 32-byte private
scalar. The subject is a contact `mailto:` URI or an HTTPS URL. Use HTTPS for deployed
browsers and keep the matching private key in secret storage. An empty public key disables
new subscriptions.

The Worker sends HTTPS requests only to recognized browser Push providers. Set
`TG_CHAT_PUSH_PROVIDER_HOSTS` to an explicit comma-separated provider host list on both
services if the deployment needs a different list. Delivery uses validated public addresses
and a bounded lease. When replacing the VAPID key pair, browsers must subscribe with the new
public key. Exercise a configured provider and the target browser/OS before enabling delivery
in a deployment.

## LiveKit calls

The `calls` Compose profile is optional. Set `TG_CHAT_CALLS_ENABLED=true`,
`TG_CHAT_LIVEKIT_API_KEY`, and `TG_CHAT_LIVEKIT_API_SECRET` in the deployment environment.
Compose supplies the shared credentials to the API, Worker, and LiveKit. The
configured `TG_CHAT_CALL_CAPACITY` limits concurrent calls across API instances. Use
`TG_CHAT_LIVEKIT_INTERNAL_URL` for the private provider API. The public signaling URL is
derived from the configured chat origin. An explicit `TG_CHAT_LIVEKIT_PUBLIC_URL` must
match that origin with the WebSocket scheme.

```sh
docker compose --profile calls up -d
```

Keep the provider's HTTP port and room administration private. Caddy authorizes new
signaling requests through the application before forwarding to LiveKit. LiveKit calls back
to the API over the private network with signed webhooks. The API grants media access only
while the designated session remains eligible. Initial and provider-refreshed tokens can
remain valid at the provider, so termination closes application admission independently
of token expiration. Already admitted connections can persist while Worker cleanup runs.

The checked-in LiveKit configuration advertises loopback for local acceptance. For real
devices, supply the reachable media address in a deployment-specific LiveKit configuration.
Replace the loopback host bindings for RTC TCP and UDP and the selected TURN transports in
the deployment's Compose configuration. Serve the chat and signaling origin with trusted TLS.
Configure the TURN public address and transport, including TLS when needed for restrictive
networks.
Keep management traffic and provider secrets out of public endpoints and request logs.
Use the [cross-network acceptance plan][m9-network] to confirm relay selection and bidirectional
audio and video on different real networks. See the [LiveKit deployment guide][livekit-deployment].

[livekit-deployment]: https://docs.livekit.io/transport/self-hosting/deployment/
[m9-network]: ./superpowers/plans/2026-11-12-m9-livekit-calls.md

## Persistence and recovery

PostgreSQL stores its database in a dedicated named volume. Valkey uses AOF in its own named
volume. RustFS stores objects and internal metadata together in `rustfs-data`. The local deployment
uses a single data directory on one disk. Its usable capacity depends on the backing filesystem,
including the Docker disk limit. The API separately enforces the configured staging, original, and
variant budgets. See [RustFS capacity checks](https://docs.rustfs.com/en/operations/status-check).

For a fresh test deployment after SeaweedFS, use a new Compose project so PostgreSQL and RustFS
start empty together. If `.env` explicitly sets the old internal S3 endpoint, update it to
`http://rustfs:9000` or remove the override to use the Compose default. Existing SeaweedFS volumes
remain available to their original projects.

`docker compose down` preserves named volumes. **`docker compose down --volumes` deletes stored
application data.** Never use it for routine restarts or deployments. The acceptance runner uses it
only for its random, isolated test project.

Quiesce writes by stopping the API, Worker, and media origin before a coordinated media backup.
Take a PostgreSQL logical dump, stop RustFS, and snapshot its complete `rustfs-data` volume.
Preserve ownership and record which dump and snapshot belong together. Restore the pair into an isolated
deployment and verify an existing message still authorizes and downloads the expected bytes.
Restore the application only after both stores are available. Resume normal writes after the
backup completes.

The media origin proxies RustFS on the published S3 port and strips application cookies.
Use a distinct cookie-free hostname and TLS for the browser-facing endpoint in a deployment.
Valkey contains expiring admission and delivery state. PostgreSQL remains the authority for
durable business records.

## Realtime recovery and retention

A realtime outage does not lose committed changes: publications carry only a cursor, and clients
continue HTTP catch-up. Expiry and retention work continue independently of publication. Worker
restarts reclaim expired leases; an old claimant cannot acknowledge a newer lease or discard a newer
coalesced position. Monitor exhausted wakeups and database admission failures as well as process health.

Inspect and retry exhausted work after repairing Centrifugo or its credentials:

```sh
docker compose exec api api wakeups list
docker compose exec api api wakeups retry --user-id "$TG_CHAT_RETRY_USER_ID"
```

Set `TG_CHAT_RETRY_USER_ID` to the account UUID reported by inspection. Retry resets only exhausted
work and retains the current target position. The backlog budget is enforced in the same transaction
as the business change; reaching it rejects the entire new change instead of silently losing wakeups.
General command receipts are retained for seven days, permanent message identity bindings remain,
and personal feed retention advances a contiguous floor after thirty days. Old clients must bootstrap
again. These are distinct lifetimes; deleting a receipt must never free a permanent send identity.

The connection registry is bounded by refresh lifetime and is reconciled against revoked, expired,
idle, and suspended sessions. Refresh and disconnection are complementary: do not remove either
when changing Centrifugo configuration. The integration follows Centrifugo's
[proxy callbacks](https://centrifugal.dev/docs/server/proxy) and
[server API](https://centrifugal.dev/docs/server/server_api).
