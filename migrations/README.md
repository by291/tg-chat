# Database migrations

Run migrations explicitly with `cargo run --bin api -- migrate` before starting the application.
API and Worker startup never mutate the schema automatically.

The catalogue begins with M2 account identities, sessions, and registration policy. Readiness requires
the complete embedded catalogue. M1's previously empty catalogue upgrades through the same explicit
migration command; existing SQLx metadata is retained.

Add ordered SQLx SQL migrations here when a feature owns a real schema change. Applied migrations
are immutable. Test changes against both a clean database and the previous supported schema.
SQLx uses PostgreSQL advisory locking to serialize concurrent migrators; do not disable it.
