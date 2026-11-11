# M8 notifications, moderation, and account lifecycle

## Outcome and approach

Connected users can manage alerts, report a message, and delete their account. Platform
operators can review cases and reverse administrative restrictions. Group and channel
administrators continue to manage their own communities. The [roadmap][roadmap] and
[product design][product] define the controlled acceptance scope. One-to-one calls arrive in M9.

Reuse the personal sync feed for durable state, PostgreSQL for policy and audit, Worker jobs for
delivery and cleanup, and expiring Valkey state for presence and typing. A second notification or
moderation service would duplicate authorization, lifecycle, and recovery decisions.

For report media, metadata-only evidence is inexpensive but may leave an image or recording
impossible to review after its source is deleted. Retain the reported attachment originals
through case-specific references to existing immutable objects. This preserves the evidence
without copying bytes or extending retention to neighboring messages and generated variants.

## Notifications and account settings

Keep unread counts and read state in the existing message flow. Add a connected notification
policy with account-wide defaults and existing per-chat mute settings. Derive alerts from
committed new-message events. An active client uses the current authorized projection for
in-app alerts and suppresses repeat alerts while the recipient is reading that conversation.
Reconnecting or rebuilding a cache does not replay old alerts.

Web Push is an optional deployment capability. Users opt in on each browser, and each
subscription belongs to an authenticated session. Revoking a session, signing out, removing
the subscription, or deleting or suspending the account detaches it. Account switching
clears device-local notification state associated with the old session. Permission denial,
an unavailable provider, or absent push configuration leaves ordinary messaging usable.

Use committed new-message events to queue delivery and fan out in bounded batches. Give each
message and subscription pair a stable notification identity. The Worker checks the
subscription, message visibility, membership, blocks, mutes, read position, and recent
foreground activity immediately before dispatch. A foreground tab suppresses Push for its
own subscribed session and can show an in-app alert for a different conversation. Other
sessions make their own eligibility decisions. Suppression leaves read state to the existing
read commands. Use bounded retries, retire invalid subscriptions, and expire stale work.
Restrict subscription delivery to supported public push endpoints and disallow redirects.

The service worker uses a generic notification by default and deduplicates by notification
identity within the browser. Keep names, bodies, and file URLs out of the push payload. Clicking
the notification opens the existing application and resolves its target through current
authorization. A missing or inaccessible target opens the inbox. Delivery is best effort,
and a previously delivered alert can remain visible after the source becomes unavailable.

Persist notification defaults and bundled sticker selection and order at account scope.
Reuse the existing synchronized contact and per-chat settings. Changes to private profile,
privacy, and verified email cause the account's sessions to refresh their authorized settings.
Appearance, wallpaper, keyboard, playback, and device choices stay local.

## Presence and typing

Use short-lived heartbeats and typing indicators. Start with active direct conversations.
Limit online observation to authorized contacts and peers in direct chats they are viewing.
Apply the observed account's audience setting to both paths. Honor blocks in both directions.
Expose a coarse online indicator and let it expire.

Authorize the conversation and peers before delivering typing updates. A backgrounded or
disconnected tab stops refreshing them. Discard delayed updates after a session or visibility
change, and let expiry cover a missed stop event. These indicators do not enter message
history or the durable feed. A Valkey outage removes the indicators while messages continue
through the existing durable path.

## Reports and evidence

An authenticated user reports one currently visible message with a reason and optional short
note. Reuse history authorization, including membership, personal hide and clear boundaries,
expiry, and quarantine. The server derives evidence from the authorized message at acceptance.
Retries return the same case. Duplicate submissions by the same reporter for the same message
do not extend evidence retention. Bound reports per account and keep the case queue paginated.

Commit the report, its evidence snapshot, and any file references together. Keep the relevant
text or caption, the visible structured content needed for review, and the identities needed
to act on the reported source. Exclude reply targets, adjacent messages, account secrets,
private poll results and answers, and private checklist attribution. Later edits, deletion,
expiry, or loss of reporter access do not change evidence already accepted.

Only original attachments attached to that exact message are retained as case media.
Resolve them from its accepted occurrences, including the occurrences of a reported forward.
Reuse the original RustFS objects through case-owned references. Coordinate report admission,
message removal, and collection under the existing ordered file locks. When only evidence
references remain, collect thumbnails, posters, and playback variants independently.
Case references grant retention and case access only. Ordinary upload reuse and download
authorization continue to depend on their own references and ready holds.

Evidence is accessible through its case to a currently authorized operator with recent
authentication. Check case and evidence expiry on every access. Deliver original bytes through
the authorized case endpoint as downloads, without exposing reusable object URLs or rendering
active content inline. Audit evidence access. Access already authorized and streaming can
finish, and the service cannot recall a copy an operator has already downloaded.

The default evidence lifetime is 90 days from acceptance. An operator can explicitly extend
an active case before expiry with a reason and a new bounded deadline in the audit record.
Closing a case does not restart its timer. At the deadline, reads stop immediately. Worker
cleanup removes the evidence and releases its references in bounded batches. RustFS collection
then removes objects whose other references and ready holds have also ended. The report dialog
explains that deletion of the source does not remove evidence already accepted. Retain minimal
case disposition and audit metadata separately from evidence.

## Platform operations

Add a small operator area to the connected frontend for registration policy, account suspension
and restoration, report review and resolution, conversation quarantine and restoration, storage
quotas, and failed-job inspection and retry. Keep the existing trusted CLI bootstrap. Browser
operations use current operator authority, session validation, and recent password
authentication for privileged actions. Group and channel roles confer community permissions.
Case resolution records the disposition. Operators can apply the account and conversation
actions from the case. Message removal follows the existing author and community rules.

Use the same policy mutations for the CLI and browser. Commit each privileged mutation and its
append-only audit entry together. Record actor, action, target, reason, and outcome. Evidence
access records the case identity. Job inspection exposes safe status and retry information.
Passwords, recovery tokens, push keys, and evidence bodies stay out of audit and job displays.
Show current storage usage and allow per-account limits within the deployment capacity. Apply
quota changes through the existing reservation checks for new work. Evidence references count
toward the retained original's lifetime under the existing quota rules. Retry only eligible
exhausted work through the job's existing lease and deduplication rules.

Suspension revokes sessions and push subscriptions, invalidates credential challenges, and
disconnects realtime. Reject new login, ordinary reads and writes, and new direct sends or
invitations to the suspended account. Other members keep access to shared content. Restoration
requires a fresh login. Group membership and shared history survive suspension.

Quarantine covers direct chats, groups, and channels. Operators reach a private direct chat
through an accepted report case. Quarantine removes a conversation from discovery and denies
ordinary admission, reads, writes, searches, media authorization, and notifications, including
for the owner. Preserve server-side history and membership for restoration. Both transitions
advance the affected visibility generations and publish changes through the personal feed.
Clients drop stale history and search projections on removal and fetch current authorized
history on restoration. Already issued ordinary signed media URLs retain the
[existing expiry limit][media].

## Account deletion

Require recent password authentication and an explicit confirmation that describes what happens
to shared messages. Check ownership inside the deletion transaction so a concurrent ownership
transfer cannot leave a live community without an owner. If the account owns a group or channel,
return the communities that must be transferred or deleted first.

Commit the account's terminal state, revoke all sessions and push subscriptions, and invalidate
credential challenges. Remove credentials and personal profile data, detach contacts and
private settings, and remove private drafts, Saved Messages, and avatar references. Perform
large private-state and media cleanup through restart-safe Worker jobs. From the terminal
transition onward, ordinary access, credential reuse, and directory discovery are denied.
Clear private browser caches and pending work when the owning session is invalidated.

Retire active community memberships and pending invitations. Rosters and admission counts
exclude deleted accounts. Shared history stays readable under its ordinary permissions, and
existing direct chats with the deleted identity remain readable to the other participant.

Keep a stable tombstone identity for shared history. Render the deleted-account label wherever
an authorized projection resolves the live author or participant, including refreshed caches.
Account links to the deleted identity become unavailable. Release its username for registration
while keeping all links and histories bound to account IDs. Existing forwarded attribution and
explicitly shared contact fields are part of accepted message content. Shared attachment
references keep their normal lifetime. Case evidence follows its own expiry. Use the existing
message rules when users want to remove shared messages before deleting their account.

## Acceptance

- Two sessions observe account-wide settings changes. Push is opt-in and works with generic
  content. Duplicate or late delivery is harmless. Read, mute, block, and revocation suppress
  pending dispatch. Messaging works with email and push disabled.
- Reports require source visibility. A case can still download its original attachments after
  source deletion and a collection pass. Other attachments and derivatives are excluded from
  evidence. Case expiry denies access and releases only the evidence references, even when a
  file remains referenced elsewhere. Verify report acceptance racing deletion and collection.
- Unauthorized and stale operator sessions fail. Authorized changes and evidence access are
  audited. Suspension fences old sessions after restoration. Quarantine and restoration
  converge across browsers and recheck search, pending operations, and new media access.
- Deletion with owned communities is rejected. After ownership is resolved, deletion revokes
  all sessions, cleans private state, releases membership capacity, and leaves shared history
  with tombstone attribution. Presence and typing expire within their authorized audience.

Choose wire contracts, job capacities, timing budgets, and schema details in the implementation
plan. Verify provider-backed background push in a configured environment and use deterministic
fixtures for delivery policy and races.

[roadmap]: ../plans/2026-11-08-product-milestones.md#m8-notifications-moderation-and-account-lifecycle
[product]: 2026-11-08-complete-product-design.md
[media]: ../../media.md#reading-and-retention
