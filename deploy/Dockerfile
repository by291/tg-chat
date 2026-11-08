FROM rust:1.98.0-bookworm AS build
WORKDIR /app

COPY Cargo.toml Cargo.lock rustfmt.toml build.rs ./
COPY src ./src
COPY migrations ./migrations
COPY tests ./tests
RUN cargo build --locked --release --bins

FROM build AS verification
CMD [ \
    "cargo", \
    "test", \
    "--locked", \
    "--release", \
    "--all-targets", \
    "--", \
    "--include-ignored" \
]

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS runtime
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app
COPY --from=build /app/target/release/api /usr/local/bin/api
COPY --from=build /app/target/release/worker /usr/local/bin/worker
USER app
CMD ["api", "serve"]

FROM node:24.15.0-bookworm-slim AS frontend
WORKDIR /app/web
RUN npm install --global pnpm@11.28.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
RUN pnpm build

FROM caddy:2.11.7-alpine AS gateway
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /app/web/dist /srv
