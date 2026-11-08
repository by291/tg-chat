# Backend development

The repository root owns the Rust API and Worker. The existing React application remains in `web/`
and still uses its local demo conversations. M1 supplies the runtime and health contract; accounts,
message persistence, authenticated realtime delivery, background jobs, and calls arrive in later
[milestones](./superpowers/plans/2026-11-08-product-milestones.md).

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
frontend. There are no account endpoints or client connection tokens yet.

PostgreSQL, Valkey, API, Worker, and Centrifugo have no published host ports. S3 is separately
exposed on `http://localhost:8333`, bound to loopback and requiring signed requests. Do not use its
internal Compose hostname in future browser upload URLs. The two S3 endpoint settings reserve these
distinct addresses for the media milestone; M1 does not yet connect the Rust service to S3.

Use `docker compose logs api worker` to inspect structured application logs. Stop services with
`docker compose down`; their named volumes remain intact. See [operations](./operations.md) before
changing credentials, exposing services, or removing volumes.

## Native Rust workflow

Use Rust 1.98 with Rustfmt and Clippy. A locally reachable PostgreSQL database is required for
migration and readiness. The integrated Compose database deliberately has no host port; use a
separate development database or add an explicit local Compose override when developing natively.

Set `TG_CHAT_DATABASE_URL` in your shell to that database's connection URL, then run:

```sh
cargo run --bin api -- migrate
cargo run --bin api -- serve
```

Run `cargo run --bin worker` in a second terminal. Default listeners are `127.0.0.1:8080` and
`127.0.0.1:8081`; change `TG_CHAT_BIND_ADDRESS` per process if they conflict with Compose.
`TG_CHAT_DB_MAX_CONNECTIONS` bounds each process pool. `TG_CHAT_LOG_LEVEL` accepts a standard log
level, not arbitrary dependency filters. `.env` is consumed by Compose, not automatically by Cargo.

Migration is explicit and serialized by PostgreSQL advisory locking. API and Worker never migrate on
startup. The M1 production catalogue is intentionally empty; SQLx initializes its metadata table.
Add real business migrations when their owning milestone is implemented. Never edit applied SQL.

## Repeatable verification

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
```

The default tests run without PostgreSQL and report the real database tests as ignored. To include
migration serialization, transactional rollback, and readiness transitions, set `DATABASE_URL` to an
**isolated test PostgreSQL instance** whose user can create databases, then run:

```sh
cargo test --locked --all-targets -- --include-ignored
```

SQLx creates isolated databases for these tests. Do not point this command at a production server.
For the complete container boundary check, run from the root:

```sh
node scripts/check-runtime.mjs
```

This runner builds images, generates ephemeral credentials and a unique Compose project, runs the
real database tests inside a Linux container, and checks routing, private ports, S3 authentication,
DB outage recovery, graceful API/Worker termination, and persistence through service restarts. It
removes only its own containers and volumes. It requires Docker, Node.js, and curl with AWS SigV4
support. A forcibly killed runner may leave its uniquely named `tg-chat-check-` project behind;
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
The OpenAPI generator uses TypeScript 5's compiler API through a scoped dependency override; the
frontend still compiles with TypeScript 7. Keep that override until the generator supports the newer
compiler API, and update the lockfile alongside dependency changes.

Frontend unit, formatting, build, and browser checks remain documented in
[frontend development](../web/docs/development.md). Backend CI checks Rust and contracts separately
from the existing frontend workflow and runs the same isolated Compose acceptance command.
