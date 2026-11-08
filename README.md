# TG Chat

A React chat application with a Telegram-inspired interface.

The runnable application lives in [web](./web/README.md).
It uses simulated conversations and stores changes on the current device.

```sh
cd web
pnpm install
pnpm dev
```

Read the architecture and development notes in the [source guide](./web/docs/source-guide.md).

Text files use LF line endings on every platform, including Windows. Repository Git attributes,
EditorConfig, and Prettier enforce the same convention without changing global Git settings.
Git detects binary assets automatically and leaves their contents unchanged.
