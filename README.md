# TG Chat

A React chat application with a Telegram-inspired interface and a Rust API/Worker backend. Connected
mode supports real accounts, private profiles, contacts, blocks, device sessions, and optional email
recovery, durable direct/Saved messages, groups and channels, rich text, and HTTP catch-up. No backend is needed to explore
the separate local demo:

```sh
cd web
pnpm install
pnpm dev
```

To start the integrated runtime with PostgreSQL, Valkey, Centrifugo, RustFS, and the frontend:

```sh
node scripts/create-local-env.mjs
docker compose up --build -d --wait
```

Open `http://localhost:8080` to register an account. The explicit `/demo` entry opens sample
conversations without using connected account state. SMTP is optional; see
[backend development](./docs/development.md) to enable local email capture.

## Documentation

- [Backend development](./docs/development.md): local runtime, verification, and generated
  contracts.
- [Runtime operations](./docs/operations.md): migrations, health, secrets, storage, and shutdown.
- [Durable messaging](./docs/messaging.md): acceptance, snapshots, rich content, and pending recovery.
- [Private media](docs/media.md) covers uploads, playback, and retention.
- [Communities and membership](./docs/communities.md): discovery, admission, roles, and access removal.
- [Accounts and recovery](./docs/accounts.md): identity, session, privacy, and durable mail boundaries.
- [Frontend overview](./web/README.md): setup, capabilities, and current scope.
- [Architecture](./web/docs/architecture.md): module boundaries, state ownership, and data flow.
- [Startup and appearance](./web/docs/startup-and-appearance.md): progressive startup and
  coordinated appearance changes.
- [Messages and history](./web/docs/message-history.md): message rendering, virtualization, and
  preserving the reader's position.
- [Editing and interactions](./web/docs/editing-and-interactions.md): composition, focus, selection,
  gestures, and forms.
- [Development](./web/docs/development.md): local commands and verification strategy.
- [Complete product design](./docs/superpowers/specs/2026-11-08-complete-product-design.md):
  approved target for the Rust backend, synchronization, media, calls, and deployment; later
  milestones extend media, administration, and calls.
- [Implementation milestones](./docs/superpowers/plans/2026-11-08-product-milestones.md): delivery
  order, dependencies, and acceptance gates for the approved product design.

The project uses GPL-3.0. See [LICENSE](./web/LICENSE) and
[third-party notices](./web/THIRD_PARTY_NOTICES.md) for asset attribution.

Completed Superpowers plans are periodically consolidated into the topic documents. Future work can
continue using Superpowers; the [documentation rules](./AGENTS.md) describe this lifecycle.
