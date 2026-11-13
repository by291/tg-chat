# Backend development

The repository root owns the Rust API and Worker. The React application remains in `web/`.
Connected mode uses real account APIs, durable messaging, authenticated realtime catch-up, and
groups and channels. `/demo` keeps local sample conversations separate. See the
[documentation index](../README.md#documentation) for the implemented boundaries.

## Start the integrated environment

Install Docker with Compose v2 or later and Node.js 24 or later. From the repository root:

```sh
node scripts/create-local-env.mjs
docker compose up --build -d --wait
```

The generator creates a private, ignored `.env` with random credentials. It refuses to overwrite an
existing file. `.env.example` documents configurable values without providing reusable passwords.
Visit `http://localhost:8080` for the frontend. The gateway routes health and `/api` requests to
Rust and `/connection/websocket` to Centrifugo. Unknown API routes return JSON instead of the
frontend. Registration is open initially. Realtime subscriptions are authorized by the API.

Email verification and recovery are disabled until SMTP is configured. To use local capture, add
these values to the generated `.env`, retaining its generated `TG_CHAT_MAIL_KEY`:

```dotenv
TG_CHAT_SMTP_HOST=mailpit
TG_CHAT_SMTP_PORT=1025
TG_CHAT_SMTP_MODE=plain
TG_CHAT_MAIL_FROM=accounts@example.test
```

Start with `docker compose --profile mail up --build -d --wait` and open `http://localhost:8025`
for captured email. The generator now includes a mail key. For an older `.env` without one,
generate a value with `openssl rand -base64 32` and copy it into `TG_CHAT_MAIL_KEY` using your
editor. Do not include the generated value in issue reports or shared command logs.
Set `TG_CHAT_PUBLIC_ORIGIN` to the exact browser origin when changing the gateway address.

PostgreSQL, Valkey, API, Worker, Centrifugo, RustFS, and the link preview fetcher have no
published host ports. The fetcher accepts API and Worker requests on its private control network
and uses a separate outbound network. Its address policy restricts page requests to public addresses.
The media origin is separately exposed on `http://127.0.0.1:8333` and requires signed S3 requests.
Use the internal endpoint for API and Worker object operations and the public endpoint for browser
signatures. See [private media](media.md#operating-the-feature) for enabling the feature.

Use `docker compose logs api worker` to inspect structured application logs. Stop services with
`docker compose down`; their named volumes remain intact. See [operations](./operations.md) before
changing credentials, exposing services, or removing volumes.

## Native Rust workflow

Use Rust 1.98 with Rustfmt and Clippy. A locally reachable PostgreSQL database is required for
migration and readiness. The integrated Compose database deliberately has no host port; use a
separate development database or add an explicit local Compose override when developing natively.

Set `TG_CHAT_VALKEY_URL` to a reachable Valkey URL. Native services default to
`redis://127.0.0.1:6379` and ignore forwarded client headers. Set SMTP values in both process
environments when using recovery; API and Worker must share the same mail key and public origin.

Set `TG_CHAT_DATABASE_URL` in your shell to that database's connection URL, then run:

```sh
cargo run --bin api -- migrate
cargo run --bin api -- serve
```

Run `cargo run --bin worker` in a second terminal. Default listeners are `127.0.0.1:8080` and
`127.0.0.1:8081`; change `TG_CHAT_BIND_ADDRESS` per process if they conflict with Compose.
`TG_CHAT_DB_MAX_CONNECTIONS` bounds each process pool. `TG_CHAT_LOG_LEVEL` accepts a standard log
level, not arbitrary dependency filters. `.env` is consumed by Compose, not automatically by Cargo.

For a connected Vite frontend, set the API's `TG_CHAT_PUBLIC_ORIGIN=http://127.0.0.1:5173` and run:

```sh
VITE_APP_MODE=connected pnpm --dir web dev --port 5173
```

Vite proxies `/api` and `/health` to `http://127.0.0.1:8080`; override
`TG_CHAT_DEV_API_ORIGIN` in Vite's environment if needed. Use the exact configured frontend origin.
Vite also proxies `/connection` to `TG_CHAT_DEV_REALTIME_ORIGIN` (default `http://127.0.0.1:8000`).
Native API/Worker require matching `TG_CHAT_CENTRIFUGO_API_KEY` and `TG_CHAT_CENTRIFUGO_PROXY_KEY`,
plus `TG_CHAT_CENTRIFUGO_URL`; configure Centrifugo's private connect/refresh callbacks to reach the API.
Unset `VITE_APP_MODE` for the standalone demo. Docker builds connected mode automatically.

Migration is explicit and serialized by PostgreSQL advisory locking. API and Worker never migrate on
startup. The catalogue includes account, recovery, messaging, synchronization, and media tables.
Never edit applied SQL.

## Repeatable verification

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
```

The default tests run without PostgreSQL and report the real database tests as ignored. To include
migration serialization, account/message races, snapshot sync, and durable jobs, set `DATABASE_URL` to an
**isolated test PostgreSQL instance** whose user can create databases. Set
`TG_CHAT_TEST_VALKEY_URL`, `TG_CHAT_TEST_SMTP_HOST`, and `TG_CHAT_TEST_SMTP_PORT` to isolated
Valkey and local SMTP capture services. Set `TG_CHAT_TEST_S3_ENDPOINT`,
`TG_CHAT_TEST_S3_ACCESS_KEY`, and `TG_CHAT_TEST_S3_SECRET_KEY` for an isolated RustFS
deployment. When the public media proxy uses a separate address, set
`TG_CHAT_TEST_S3_PUBLIC_ENDPOINT` too. Linux codec tests require FFmpeg, util-linux, and
libseccomp development headers. Then run:

```sh
cargo test --locked --all-targets -- --include-ignored \
  --skip explicitly_created_room_can_be_listed_and_deleted
```

SQLx creates isolated databases for these tests. Do not point this command at a production server.
For the complete container boundary check, run from the root:

```sh
node scripts/check-runtime.mjs
```

This runner builds images, generates ephemeral credentials and a unique Compose project, runs the
real Rust tests inside a Linux container, and runs account/messaging browsers against the built
frontend and Mailpit. It drops a real committed message response, restarts API, and verifies replay
and recipient visibility. It interrupts Worker/Centrifugo, clears Valkey, checks retention-floor
rebootstrap, and runs the four-session synchronization browser suite. The paired restore drill
checks an existing attachment after restoring PostgreSQL and RustFS inside the test project.
Off-host recovery and recovery objectives belong to [release acceptance][release-acceptance].

Independent fixture phases reset only the isolated project's Valkey cache to avoid sharing
registration rate limits through one loopback address. The runner checks routing, private ports,
the Worker's control path to the preview fetcher, S3 authentication, PostgreSQL and Valkey outages,
graceful API and Worker termination, and persistence through service restarts. It removes its own
containers and volumes.
The runner requires Docker, Node.js, and curl with AWS SigV4
support, installed frontend dependencies, and Chromium (`pnpm --dir web exec playwright install
chromium`). A forcibly killed runner may leave its uniquely named `tg-chat-check-` project behind;
inspect the exact project before removing it.

## Connected feature checks

The default runtime check orchestrates these suites with disposable fixtures. To run a suite
individually, point `TG_CHAT_ACCOUNT_TEST_URL` at an isolated connected deployment. Use the
[frontend development guide](../web/docs/development.md) for browser setup and media prerequisites.

- `pnpm --dir web test:media` closes the last browser tab after a multipart interruption and a
  lost part acknowledgement. Reopen to verify that only missing parts upload and the original
  pending identity becomes one accepted message.
- `pnpm --dir web test:interactions` exercises poll and checklist convergence, forwarded
  attachment access after source deletion, distant Chinese search, and preview opt-out.
  Real-service tests cover restricted results, stale revisions, and forwarding and search access.
- `pnpm --dir web test:lifecycle` checks report original downloads after source deletion,
  recent operator authentication, quarantine and restoration, and deletion with an ownership
  conflict. The full runner supplies the operator and media fixtures. Real PostgreSQL tests
  verify evidence expiry, reference release, and concurrent source removal.

Physical voice-message checks remain tracked under
[connected media capability checks](../web/docs/development.md#connected-media-capability-checks).

## Web Push verification

The lifecycle suite runs with SMTP and Push credentials absent. It checks foreground alerts and
uses synthetic Chromium service-worker events to verify deduplication and authorized click routing.
Service tests exercise dispatch eligibility and retries with a deterministic transport.

For provider-backed acceptance, configure [Web Push delivery](./operations.md#web-push-delivery)
on an HTTPS deployment. Opt in on a target browser and OS. Send from another account while the
subscribed session is in the background, check that the OS displays a generic notification, and
follow it to the authorized conversation. Repeat with read or mute suppression and subscription
revocation. Record the provider, browser, OS, and observed delivery behavior.

## Call verification

Run the calls-enabled acceptance separately from the default runtime check.

```sh
node scripts/check-runtime.mjs --calls
```

The runner uses an isolated Compose project, Chromium with controlled media devices, and the
real LiveKit media path. It checks competing accepts, one-click media setup, voice and video,
permission denial, collapse and restore, timer continuity after reopening, same-mode callback
from a missed record, and terminal signaling rejection.
It repeats the call flow after verifying that ordinary messaging works with LiveKit stopped.
The default runtime check keeps calls disabled.

The provider contract fixtures exercise explicit room creation and deletion and
two-participant admission. Use a disposable LiveKit instance and set
`TG_CHAT_LIVEKIT_API_KEY`, `TG_CHAT_LIVEKIT_API_SECRET`, and
`TG_CHAT_LIVEKIT_INTERNAL_URL` with a loopback HTTP URL. The browser fixture also requires
a loopback `TG_CHAT_LIVEKIT_PUBLIC_URL` with the `ws` scheme. Run from the repository root:

```sh
cargo test --locked --test livekit_integration -- --include-ignored
pnpm --dir web exec playwright test -c playwright.calls.config.ts livekit-contract.spec.ts
```

The [cross-network acceptance plan][m9-network] tracks physical microphone, camera, and TURN
verification.

[release-acceptance]: ./superpowers/plans/2026-11-08-product-milestones.md#m10-release-performance-and-recovery-acceptance
[m9-network]: ./superpowers/plans/2026-11-12-m9-livekit-calls.md

## API contract ownership

Rust response types and Utoipa annotations own `openapi/api.json`. The frontend consumes generated
TypeScript definitions in `web/src/api/schema.d.ts`. After changing a public response or route:

```sh
cd web
pnpm install --frozen-lockfile
pnpm api:generate
pnpm api:check
```

Generation runs the Rust exporter without database settings or service credentials. CI regenerates
both artifacts and compares them to the checked-in versions. Do not edit generated types by hand.
The OpenAPI generator uses TypeScript 5's compiler API through the scoped `.pnpmfile.cjs` install
hook; the frontend still compiles with TypeScript 7. Keep that hook until the generator supports the newer
compiler API, and update the lockfile alongside dependency changes.

Frontend unit, formatting, build, and browser checks remain documented in
[frontend development](../web/docs/development.md). Backend CI checks Rust and contracts separately
from the existing frontend workflow and runs the same isolated Compose acceptance command.

The isolated runtime check also runs `test:communities` with five account contexts, covering public
admission, approvals, private invitations, member removal, and channel subscriber permissions.
Admission fixtures are reset only inside the disposable Compose project between suites.
