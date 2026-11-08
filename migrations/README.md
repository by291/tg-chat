# Database migrations

Run migrations explicitly with `cargo run --bin api -- migrate` before starting the application.
API and Worker startup never mutate the schema automatically.

M1 has no business tables. Its empty embedded catalogue still initializes SQLx migration metadata.
Readiness requires this initialization. The first business migration belongs to M2.

Add ordered SQLx SQL migrations here when a feature owns a real schema change. Applied migrations
are immutable. Test changes against both a clean database and the previous supported schema.
SQLx uses PostgreSQL advisory locking to serialize concurrent migrators; do not disable it.
