# Architecture

## Design direction

The application has a connected account and messaging workspace and an explicit local conversation demo. React
owns rendering and lifecycle. Domain values, durable state changes, and temporary UI state have
separate owners so changes to one do not require rebuilding the others.

The structure follows responsibilities rather than uniform folder templates or file-size limits.
Code that changes together stays together. A module is split when it contains independent concepts,
not merely because it has grown long.

## Module boundaries

`App.tsx` installs application-wide input policy and selects the configured mode. Connected mode
loads the account application; `/demo` lazy-loads the existing chat page and its navigation.
Layouts arrange their rendered slots without deciding business behavior.

The domain layer defines messages, conversations, media, and validated content. It does not depend
on React, feature components, or persistence. Features implement user capabilities such as chat,
editing, conversation management, settings, and media viewing. Each feature keeps its private
components, styles, hooks, and tests close to the behavior they support.

Shared components and browser utilities contain generic capabilities, not business rules relocated
for convenience. Features may use another owner's clear interface; generic modules must not import
features. Direct imports make ownership visible without adding forwarding modules at every level.

The main entry points are `src/App.tsx`, `src/pages/chat/ChatPage.tsx`, and `src/features/`.
`src/domain/` contains reusable contracts; `src/layouts/`, `src/components/`, `src/hooks/`,
`src/lib/`, and `src/routes/` hold the corresponding structural and shared responsibilities.

## State ownership

State is divided by lifetime and authority:

- The connected session owner holds server account state in memory and fences asynchronous work
  across logout, revocation, and account changes. Account pages consume generated HTTP contracts.
  [Accounts and recovery](../../docs/accounts.md) owns this boundary and its security constraints.
- The demo conversation reducer owns messages, drafts, conversation preferences, and business actions.
  A single action can update related values consistently, such as sending a message and clearing
  its draft or forwarding a selected batch.
- React Router owns navigable destinations. Chat, archive, and settings URLs support direct links
  and browser history. Unrelated query parameters survive navigation.
- Zustand owns validated application preferences. Components subscribe to the fields they need;
  playback and notification code can read the same preferences without mounting UI.
- Components own temporary interaction state such as menus, searches, selections, and dialogs.
  State that must survive a particular panel transition lives above that panel's lifetime boundary.

A URL requests a conversation; restoration must finish before that request can be resolved. An
unknown or deleted destination shows the unselected state. Explicit user selection and browser
history remain distinct actions, so navigating back cannot silently recreate a deleted chat.

Panel visibility and panel lifetime are also separate. Sidebar pages and selected overlays can
remain mounted through transitions to preserve drafts, focus, and scroll position. Conversation
identity resets conversation-specific editing context, preventing it from leaking into another chat.

## Data flow and derived views

In the demo, user input produces a domain-level command. The conversation layer supplies identity and context,
the reducer applies the durable change, and the persistence layer saves the resulting snapshot.
Rendering subscribes to that state; persistence does not drive individual UI interactions.

Derived conversation metadata and message indexes are shared at the workspace level. A draft edit
should not rebuild an unrelated conversation directory, restart a mute timer, or invalidate every
message row. Views receive the smallest useful inputs, while business actions remain centralized.

Notification arrival detection follows message changes. Delivery reads the current notification
policy, so changing a preference does not replay messages that were intentionally suppressed.

## Persistence and backend boundary

Demo storage input is validated before it becomes application state. A failed restore leaves a usable
local interface; a failed write reports the problem while allowing the current session to continue.
Existing storage keys and serialized shapes are compatibility contracts. Fixture upgrades preserve
user changes and do not recreate content the user already removed.

The current persistence unit is a conversation snapshot. Bounding rendered rows does not bound
stored data, and preference storage events do not provide concurrent conversation editing. Keep
this local model until backend requirements justify changing it.

Connected mode now supplies server identities, durable direct messages, and HTTP catch-up through
its data owner. Later milestones extend delivery, lifecycle commands, and durable cache coordination
through that boundary. Rendering and scroll measurement
remain frontend responsibilities.

## Related designs

[Startup and appearance](./startup-and-appearance.md) explains readiness and resource transitions.
[Messages and history](./message-history.md) explains the rendering and scrolling model.
[Editing and interactions](./editing-and-interactions.md) explains input ownership.
[Development](./development.md) describes how those contracts are verified.

## Connected message ownership

The authenticated workspace owns a `ChatOwner` for its session lifetime, including while account
settings are open. It supplies bounded canonical projections to the existing composer and timeline;
it never mounts the demo reducer or demo conversation persistence. A React identity provider gives
shared renderers the authenticated user while preserving the demo default outside connected mode.

Pending operations and drafts use transactional IndexedDB ownership. Canonical message projections
remain in memory in M3; future durable cache/checkpoint work belongs to M4. See
[durable messaging](../../docs/messaging.md) for acceptance, cursor, and recovery guarantees.
