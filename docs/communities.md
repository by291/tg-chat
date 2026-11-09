# Communities and membership

Groups and channels share the existing conversation, message, and personal synchronization model.
PostgreSQL decides who can read or change a community. Browser controls reflect its authorized
projection; they never grant access. See [durable messaging](./messaging.md) for message identity,
cache checkpoints, and recovery, and [accounts](./accounts.md) for session and block policy.

## Admission and visibility

Public discovery exposes bounded community metadata, not history or private membership. Private,
deleted, quarantined, and banned communities do not appear. Public handles are normalized and unique
among nondeleted communities. Creation and admission consume an ordinary personal directory slot;
Saved Messages retains its reserved slot. Pending invitations and approval requests consume no slot.
Groups and channels also enforce their own active membership budgets.

Public communities admit directly or require approval. Private communities require an invitation.
Targeted invitations belong to one recipient and require explicit acceptance. Link invitations carry
an opaque cryptographically random secret; only its hash is stored on the server. The browser puts
the secret in a URL fragment and sends it in a POST body for preview or joining, keeping it out of
server URL logs. API consumers must generate the same random secret contract as the browser.
The link must be copied after successful creation; management queries cannot reconstruct it.

Invitations expire, can be revoked, and may have a use budget. The final successful admission consumes
one use under the conversation lock. Approval rechecks the original invitation, current ban and
suspension state, and both capacity budgets. Public-to-private transitions remove discovery and
invalidate pending requests that relied on public admission. Link-based requests retain their own
source and are still checked when approved.

Admitted members can read all retained history, including history predating their admission. Personal
hide and clear cutoffs still apply. Leaving or removal immediately revokes history access. A ban also
blocks readmission until explicitly lifted; unbanning alone does not admit the account again.

## Roles and publication

Owners alone assign administrators, transfer ownership, or delete the community. Administrators can
manage ordinary members, invitations, requests, message pins, and automatic expiry. They can remove
others' messages but cannot edit another author's content. The owner must transfer ownership or
delete the community before leaving. Transfer makes the former owner an administrator.

Group members can publish unless muted. Channel publication requires an owner or administrator.
Channel messages display the community title while retaining the authenticated actor identifier for
audit and author-only editing. Ordinary channel subscribers can inspect only their own membership;
administrators can inspect the subscriber directory. Group members can inspect their member list.

Shared permission checks cover sends, edits, deletion, pins, expiry, snapshots, and history. Personal
archive, hide, unread, mute, clear, and draft operations retain their existing per-account ownership.
Quarantine already denies ordinary access; administrative quarantine workflows arrive in M8.

## Transactions and synchronization

Membership mutations lock the conversation first, then affected accounts in UUID order, followed by
personal sync heads. This is also the message publication order, so a concurrent join or leave cannot
produce partial admission or an unauthorized publication recipient. Foreign keys involved in new
conversation ownership are deferred to preserve the account lock order.

A transaction updates membership, roles, generations, and personal change groups together. Removed
members receive a nullable conversation projection. Existing client cache rules purge the canonical
history and reject stale acknowledgements after a reset or removal. Message fanout includes all
current admitted members. Realtime is a wakeup hint; HTTP catch-up remains authoritative.

Settings use an independent expected revision. A simultaneous metadata or privacy change conflicts
instead of overwriting another administrator's work. Message and membership traffic does not cause
false metadata conflicts. The browser retains local edits and offers an explicit reload.

Every mutation carries a stable operation UUID. The browser persists community operations before
transport and retains uncertain requests across reloads. Explicit retries reuse their exact payload,
including generated invitation secrets. Retrying after receipt retention is refused: inspect current
state and dismiss the old record before deciding on a new action. Dismissing a record does not undo a
server operation. Account invalidation fences these records with the existing storage tombstone.

## Verification and remaining scope

The real PostgreSQL tests cover capacity boundaries, normalized handle uniqueness, ownership,
authorization, subscriber privacy, concurrent admission/publication, final invitation use, revoked
approval, and stale settings. The community browser suite exercises five separate accounts through
actual discovery, administration, approval, private invitations, leaving, removal, and channel reads.
It checks that a removed reader loses visible history and receives a denial on a fresh history read.

Run `pnpm --dir web test:communities` against a disposable runtime configured through
`TG_CHAT_ACCOUNT_TEST_URL`. The [integrated runtime check](./development.md#repeatable-verification) runs this
suite alongside account, message, synchronization, and service-recovery checks. Functional capacity
tests do not establish production throughput. Media, avatars, message search, administrative tools,
and LiveKit calls remain assigned to later milestones.
