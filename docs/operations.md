# Runtime operations

M1 provides a reproducible single-host development runtime. It is the foundation for the
[approved product](./superpowers/specs/2026-11-08-complete-product-design.md), with no accounts,
business persistence, job processing, or call service yet. The Worker currently owns its lifecycle
and internal health listener; later milestones will attach durable jobs to it.

## Startup and migration ordering

Create `.env` with `node scripts/create-local-env.mjs`, then run
`docker compose up --build -d --wait`. PostgreSQL becomes healthy first, the one-shot `migrate`
service initializes or upgrades its schema, and API/Worker start after migration succeeds.
Centrifugo depends on healthy Valkey. Caddy waits for API and Centrifugo before serving the
frontend. SMTP and LiveKit are optional future services and are not required to start this
environment.

For an explicit migration after rebuilding the application image:

```sh
docker compose build api worker migrate
docker compose run --rm migrate
docker compose up -d --wait api worker gateway
```

Run migrations before replacing application processes. M1 readiness requires the **exact embedded
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
terminating them, and readiness recovers when the database returns. M1 does not report Valkey or S3
as API readiness dependencies because no implemented API behavior uses them yet. Centrifugo and
SeaweedFS have their own process probes; the SeaweedFS probe checks its master, while acceptance
separately verifies signed S3 requests. Health probes are not a substitute for end-to-end
monitoring.

SIGTERM and Ctrl+C stop new HTTP acceptance, drain active requests with a deadline, and close the
connection pool with another deadline. Compose allows time for these deadlines before force-killing
containers. API and Worker log startup, draining, and stop events. There is no work lease to drain
in M1; durable job shutdown will be implemented with the job owner.

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
Centrifugo rejects client sessions without valid tokens. M1 does not issue those tokens.

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
operational milestones. No high-availability or production readiness is claimed by M1.

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
consistent backup procedure. Valkey will eventually hold disposable delivery/cache state; PostgreSQL
remains the planned authority for durable business records. Merely retaining a local Docker volume
is not a backup, and persistence tests do not establish disaster-recovery guarantees.
