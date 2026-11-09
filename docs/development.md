# Backend development

The repository root owns the Rust API and Worker. The React application remains in `web/`.
Connected mode uses real account APIs and durable mail jobs; `/demo` keeps local sample conversations
separate. Durable messaging, authenticated realtime catch-up, and groups/channels are connected. Media and
calls arrive in later [milestones](./superpowers/plans/2026-11-08-product-milestones.md). See
[accounts and recovery](./accounts.md), [messaging](./messaging.md), and
[communities](./communities.md) for the implemented boundaries.

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

PostgreSQL, Valkey, API, Worker, and Centrifugo have no published host ports. S3 is separately
exposed on `http://localhost:8333`, bound to loopback and requiring signed requests. Do not use its
internal Compose hostname in future browser upload URLs. The two S3 endpoint settings reserve these
distinct addresses for the media milestone; the account service does not yet connect to S3.

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
startup. The catalogue owns account, relationship, audit, challenge, mail-job, conversation, message, and personal-sync tables.
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
Valkey and local SMTP capture services, then run:

```sh
cargo test --locked --all-targets -- --include-ignored
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
rebootstrap, and runs the four-session synchronization browser suite. Independent fixture phases reset only the isolated project’s Valkey cache
to avoid sharing registration rate limits through one loopback address. It checks routing, private ports, S3 authentication, PG/Valkey outage behavior, graceful
API/Worker termination, and persistence through service restarts. It
removes only its own containers and volumes. It requires Docker, Node.js, and curl with AWS SigV4
support, installed frontend dependencies, and Chromium (`pnpm --dir web exec playwright install
chromium`). A forcibly killed runner may leave its uniquely named `tg-chat-check-` project behind;
inspect the exact project before removing it.

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
