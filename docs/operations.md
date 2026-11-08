# Runtime operations

The single-host runtime supports accounts, sessions, contacts, and optional email recovery.
PostgreSQL owns durable account and mail-job state; the Worker delivers leased email jobs.
Messaging, media, and calls remain later parts of the
[approved product](./superpowers/specs/2026-11-08-complete-product-design.md).

## Startup and migration ordering

Create `.env` with `node scripts/create-local-env.mjs`, then run
`docker compose up --build -d --wait`. PostgreSQL becomes healthy first, the one-shot `migrate`
service initializes or upgrades its schema, and API/Worker start after migration succeeds.
Centrifugo depends on healthy Valkey. Caddy waits for API and Centrifugo before serving the
frontend. SMTP is optional and LiveKit is a future service; neither is required to start this
environment. Without SMTP, account capabilities explicitly disable new verification/recovery
requests. Existing verified addresses remain private account data.

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
fail API readiness. S3 is not an account dependency. Centrifugo and
SeaweedFS have their own process probes; the SeaweedFS probe checks its master, while acceptance
separately verifies signed S3 requests. Health probes are not a substitute for end-to-end
monitoring.

SIGTERM and Ctrl+C stop new HTTP acceptance, drain active requests with a deadline, and close the
connection pool with another deadline. Compose allows time for these deadlines before force-killing
containers. API and Worker log startup, draining, and stop events. Worker shutdown stops new claims
and allows bounded completion of its current SMTP attempt. A crashed claim becomes eligible for
recovery after its lease expires; a stale worker cannot finish a newer claim.

## Secrets, network boundaries, and logs

Keep `.env` private and out of source control. The bootstrap script sets owner-only file
permissions. Database passwords, Centrifugo signing/API keys, and S3 credentials are required at
Compose startup. PostgreSQL only uses its initialization password on an empty volume: changing
`.env` alone does not rotate an existing database password. Coordinate credential rotation with the
owning service.

Keep a manually changed database password URL-safe; Compose embeds it in a PostgreSQL connection
URL. SeaweedFS resolves S3 credentials from the static identity file's environment references,
avoiding the AWS fallback's access-key startup log. The checked-in identity file contains no usable
credentials.

Only the frontend gateway and authenticated S3 endpoint publish loopback host ports. Database,
Valkey, internal health listeners, Centrifugo administration/API, SeaweedFS filer, volume, and
master ports remain inside the Compose network. The S3 credential has broad local storage access;
future application upload URLs must use scoped, expiring signatures rather than revealing this key.
Centrifugo rejects client sessions without valid tokens. Account APIs do not issue those tokens.
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

The command reads stdin until EOF; supply one password line from a pipe or redirected private file.
Do not place passwords in argv or shell history. A privileged identity is reserved for the later
administration UI; current administration remains trusted CLI work.

```sh
docker compose exec -T api api operator close-registration --reason 'Maintenance window'
docker compose exec -T api api operator open-registration --reason 'Maintenance completed'
docker compose exec -T api api operator suspend --username member_one --reason 'Abuse review'
docker compose exec -T api api operator restore --username member_one --reason 'Review completed'
```

Suspension revokes every session and invalidates outstanding credential challenges. Restoration
requires a fresh login and never revives old cookies. Registration policy changes serialize with
new admissions. Audit rows identify the trusted CLI actor and reason; the database rejects audit
updates, deletion, and truncation. This is not tamper-proof against a database administrator.

## Mail delivery and protected payloads

Configure the same SMTP sender, transport, public origin, and `TG_CHAT_MAIL_KEY` for API and Worker.
Use `starttls` or `tls` for remote SMTP; plaintext is accepted only for explicit local capture hosts.
Set both SMTP username and password when authentication is required. Invalid partial configuration
fails startup. [Development](./development.md) documents the optional Mailpit profile.

Retain the Base64-encoded 32-byte key alongside database backups using your secret-storage process.
Pending email payloads are AES-GCM encrypted and bound to their job identity. Replacing the key
does not rotate existing ciphertext: use a coordinated drain before changing it, and retain the
old key for any backup containing its pending jobs. A wrong key prevents those jobs from delivering.
There is no automatic multi-key rotation or exhausted-job replay command in M2.

The Worker logs job IDs and safe outcomes. Inspect job status, attempts, scheduled retry time, and
lease expiry through trusted database access when troubleshooting; avoid dumping encrypted payloads,
challenges, or recipient data into shared logs. Exhausted jobs are retained but do not count against
the pending/running queue budget. Diagnose SMTP/key failures, then let users request fresh links
after the cause is fixed. Terminal-row retention and cleanup require operator policy until a later
maintenance milestone provides automated retention.
Successful and discarded jobs erase payload bytes. See [accounts](./accounts.md) for transaction,
single-use, and at-least-once delivery constraints.

## Persistence and recovery

PostgreSQL stores its database under its dedicated named volume. Valkey uses AOF in its own named
volume. SeaweedFS runs master, volume, filer, and S3 together for local use; master metadata, object
volumes, and the filer's LevelDB metadata share a persistent SeaweedFS volume. Preserving only blob
files without filer metadata is insufficient for recovery.

`docker compose down` preserves named volumes. **`docker compose down --volumes` deletes stored
application data.** Never use it for routine restarts or deployments. The acceptance runner uses it
only for its random, isolated test project.

Use PostgreSQL's logical backup tools for a consistent database backup. Back up SeaweedFS metadata
and object storage together while its single process is stopped, or use an explicitly tested
consistent backup procedure. Valkey currently holds expiring admission counters and will also hold
delivery/cache state; PostgreSQL remains the authority for durable business records. Merely retaining a local Docker volume
is not a backup, and persistence tests do not establish disaster-recovery guarantees.
