# TG Chat

A React chat application with a Telegram-inspired interface and a Rust API/Worker foundation. The
frontend currently runs with local conversations and device storage; business features are not yet
connected to the backend. A backend is not required to explore the frontend.

```sh
cd web
pnpm install
pnpm dev
```

To start the integrated runtime with PostgreSQL, Valkey, Centrifugo, SeaweedFS, and the frontend:

```sh
node scripts/create-local-env.mjs
docker compose up --build -d --wait
```

Open `http://localhost:8080`. The runtime currently supplies health endpoints, explicit migrations,
safe process lifecycle, and generated API contracts. Accounts and messaging arrive in later
milestones.

## Documentation

- [Backend development](./docs/development.md): local runtime, verification, and generated
  contracts.
- [Runtime operations](./docs/operations.md): migrations, health, secrets, storage, and shutdown.

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
  approved target for the Rust backend, synchronization, media, calls, and deployment; M1
  establishes the runtime; remaining product capabilities are planned.
- [Implementation milestones](./docs/superpowers/plans/2026-11-08-product-milestones.md): delivery
  order, dependencies, and acceptance gates for the approved product design.

The project uses GPL-3.0. See [LICENSE](./web/LICENSE) and
[third-party notices](./web/THIRD_PARTY_NOTICES.md) for asset attribution.

Completed Superpowers plans are periodically consolidated into the topic documents. Future work can
continue using Superpowers; the [documentation rules](./AGENTS.md) describe this lifecycle.
