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
The optional [LiveKit calls profile](./docs/operations.md#livekit-calls) enables one-to-one voice
and video from existing direct conversations.

## Documentation

### Product and backend

- [Product and runtime architecture](./docs/architecture.md) explains product scope and service
  ownership.
- [Accounts and recovery](./docs/accounts.md) covers identity, privacy, sessions, and durable mail.
- [Communities](./docs/communities.md) covers discovery, membership, roles, and access removal.
- [Durable messaging](./docs/messaging.md) covers acceptance, synchronization, and pending recovery.
- [Private media](./docs/media.md) covers uploads, playback, report evidence, and retention.
- [One-to-one calls](./docs/calls.md) covers ringing, media authorization, and call history.

### Development and release

- [Backend development](./docs/development.md) covers the local runtime, verification, and contracts.
- [Runtime operations](./docs/operations.md) covers deployment, storage, shutdown, and restore.
- [Release and capability acceptance](./docs/release-acceptance.md) tracks M10 and outstanding
  browser, physical device, and TURN checks.

### Frontend

- [Frontend overview](./web/README.md) covers setup and capabilities.
- [Frontend architecture](./web/docs/architecture.md) covers module boundaries and state ownership.
- [Startup and appearance](./web/docs/startup-and-appearance.md) covers loading and transitions.
- [Messages and history](./web/docs/message-history.md) covers rendering, virtualization, and scroll.
- [Editing and interactions](./web/docs/editing-and-interactions.md) covers composition, focus,
  selection, gestures, and forms.
- [Frontend development](./web/docs/development.md) covers local commands and verification.

The project uses GPL-3.0. See [LICENSE](./web/LICENSE) and
[third-party notices](./web/THIRD_PARTY_NOTICES.md) for asset attribution.

Completed Superpowers plans are periodically consolidated into the topic documents. Future work can
continue using Superpowers; the [documentation rules](./AGENTS.md) describe this lifecycle.
