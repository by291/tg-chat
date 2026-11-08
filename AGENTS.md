# Repository documentation

## Dependency selection

Prefer maintained libraries for protocol handling, configuration, validation, migrations, and other
general-purpose work. There is no artificial limit on dependencies: use a suitable library when it
removes application-owned complexity. Keep project code focused on business rules and necessary
integration, and avoid reimplementing mature library behavior. Apply this convention across the
entire project, including future milestones. Choose compatible versions and verify the behavior at
the application's boundary.

## Organization

Use the root README as the documentation entry point and `web/README.md` for frontend setup and
capabilities. Keep backend development and operational guidance under `docs/`.
Keep frontend design documents under `web/docs/`, organized by architecture, startup and
appearance, messages and history, editing and interactions, and development.

Explain the problem a design solves, its responsibilities, how the parts collaborate, and the
constraints that future changes must preserve. Keep each topic in its owning document and link
between topics instead of repeating their details.

Do not turn the design documents into upstream comparisons, file-by-file inventories, visual
measurement logs, or historical test reports. Exact constants and implementation details belong
in code. Keep license and asset provenance in the third-party notices and asset source manifests.

## Periodic consolidation

Continue using applicable Superpowers skills for future work. Documentation cleanup does not
prevent creating new plans or specifications under `docs/superpowers/` or `web/docs/superpowers/`.

During a requested cleanup, compare completed plans with the current implementation. Extract
lasting design decisions, behavioral constraints, and useful verification guidance into the topic
documents, then delete superseded working documents and update links. Keep active or unresolved
plans; do not describe unimplemented proposals as current behavior.

Do not preserve temporary server addresses, scratch artifacts, or old passing test counts as
ongoing guarantees. Describe repeatable checks and their limits in the development guide.
