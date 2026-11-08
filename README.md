# TG Chat

A React chat application with a Telegram-inspired interface. The frontend currently runs with
local conversations and device storage; a backend is not required to explore its functionality.

```sh
cd web
pnpm install
pnpm dev
```

## Documentation

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
  approved target for the Rust backend, synchronization, media, calls, and deployment;
  not implemented yet.
- [Implementation milestones](./docs/superpowers/plans/2026-11-08-product-milestones.md): delivery
  order, dependencies, and acceptance gates for the approved product design.

The project uses GPL-3.0. See [LICENSE](./web/LICENSE) and
[third-party notices](./web/THIRD_PARTY_NOTICES.md) for asset attribution.

Completed Superpowers plans are periodically consolidated into the topic documents. Future work
can continue using Superpowers; the [documentation rules](./AGENTS.md) describe this lifecycle.
