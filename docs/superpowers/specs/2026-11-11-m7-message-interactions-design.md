# M7 message interactions and history discovery

## Outcome and approach

Connected chats support polls, collaborative checklists, forwarding, bundled stickers, contact
cards, message search, and text link previews. Reuse the existing composer forms, cards, recipient
picker, and search surfaces. The API owns accepted messages and interactions, PostgreSQL owns
their state, and the existing sync feed carries committed changes to other devices. Keep the demo
as a standalone local experience.

Use Telegram's familiar flows for voting, checklist permissions, choosing a forwarding
destination, and filtering search. Extend the existing message contracts and bounded history
navigation. A separate interaction store or search service would introduce a second permission
and consistency boundary for the same messages. The [roadmap][roadmap] and [product design][product]
define the milestone scope and shared policies.

## Message types and read projections

Extend the versioned message representation with typed bodies and server-owned interaction
state. Preserve existing text and caption requests and their retry identities. Keep public
content, per-reader choices, and restricted state distinct when building a response. Use the
same projection rules for acceptance receipts, history, sync, search, and action responses.
Advance the interaction revision independently of text edits. A stale response cannot restore
content after a visibility change or overwrite a newer interaction.

Keep the existing custom-emoji validation and extend the bundled catalogue to sticker IDs.
Resolve assets through the deployed catalogue and preserve provenance. Send a contact card as a
bounded snapshot of explicitly selected fields. The first form supports a name, an optional
visible account link, and an explicitly supplied phone number. Sharing an account does not
populate its private phone or email. Opening the account from a received card uses normal
profile and contact permissions.

## Polls and checklists

Polls support single and multiple choice, public or anonymous voting, quiz mode, optional
revoting, hidden results until close, permitted option additions, and early closure. Stable
option IDs survive updates. A vote sets the account's complete selection in one transaction
under the poll lock. Retries of the same operation return the accepted result. The database
deadline applies even if the background closure update has yet to reach other devices.

Hidden-result polls withhold totals until close and still show the reader their own selection.
Anonymous votes never expose voter identities. Public voter lists are paginated and available
to authorized readers when results are visible. The voting UI identifies public voting before
submission. A quiz reveals the answer and explanation to the reader after they submit, or to
all eligible readers after closure. The author configures the answer at creation, and each voter
can submit one answer set. After the first vote, freeze
the question, rules, and existing options. Participant-added options are available on public,
non-quiz polls when enabled. Authors and authorized moderators can close polls early.

Checklists have independent permissions for other members to mark tasks and append items.
The author can edit the structure and set both permissions. Each completion command includes
the desired state and expected task version. Structural changes use a separate list version.
This lets two members finish different tasks concurrently. A conflicting change to the same
task or structure returns the current authorized state. Record the completing account.

All participation requires current message visibility and conversation membership. Apply
current direct-message blocks and group interaction restrictions. Channel subscribers can vote
and use enabled checklist actions without gaining permission to post messages. Channel polls
use anonymous voting. On a channel checklist, subscribers see completion state and their own
attribution. Channel administrators can see who completed tasks. This preserves subscriber
privacy. Deleting or expiring a message closes its interactions. Persist accepted mutations and
their sync changes together so a reload or a second device observes the same result.

## Forwarding and batch actions

Use the existing message selection and recipient picker. Forwarding submits source message IDs
and a stable operation identity for each destination. The server verifies source visibility,
current source forwarding policy, and destination posting permission in the transaction.
Keep each bounded destination batch atomic. Report destinations independently and retry a
lost response with the same operation identity. Leave the destination draft intact.

Use the conversation policy in the product design. Group and channel owners control it. Either
direct participant may disable forwarding. Disabling clears prior consent, and both participants
must opt in again to restore it. The Saved Messages owner controls that conversation's setting.
A policy change applies to future forwards. Existing copies remain governed by their own
destination. Batch delete and hide apply per-conversation limits and the existing message
permissions to every item.

Each forward creates a new message with stable source attribution. Display the source author
or channel label that the forwarder was authorized to see. Attribution confers no source access.
The destination copy has independent content and attachment occurrences. Add references to the
same immutable files under the M6 file lock, so deleting the source cannot collect a file still
used by a forwarded message. Never accept arbitrary file IDs as forwarding authority.

Forward a poll as its question and options and a checklist as its title, tasks, and completion
states. These snapshots are read-only and omit voter identities, vote totals, quiz answers,
explanations, and completion identities. Keep that sanitization when forwarding a copy again.

## Search and history discovery

Offer the same search service in a conversation and from the sidebar. Global message search
covers the account's accessible conversations. Reuse existing people and conversation discovery
for directory matches. Search normalized plain text and captions, with sender, date, and
supported message-type filters. Use a literal, case-insensitive substring match and preserve
Chinese substring behavior. PostgreSQL trigram indexes accelerate eligible queries. Treat `%`
and `_` as literal characters in user input.

Limit one- and two-character text queries to a single conversation with a finite date range
and bounded query work. Use a recent window when the user has chosen no dates, and display the
applied range. Require a longer term for global text search. An empty text query with
a media, file, or link filter can browse that conversation through the same bounded history
interface. Use deterministic cursor pagination and apply membership, hidden/cleared state,
expiry, and deletion checks before returning hits or navigation targets. Index neither private
contact details nor restricted poll data. Do not return unauthorized snippets or counts.

Reuse existing pinned history and target-message neighborhoods. Add date anchors and filtered
media history using the same visibility rules. Selecting a result opens the chat at the target
without fetching intervening pages. If access changes between search and navigation, show an
unavailable target and discard stale results for that conversation.

## Text link previews

After accepting or editing a message, queue a preview for its first eligible public HTTP(S) URL
unless the sender disables previews. Keep one preview per message. Publish the site name, title,
and plain-text summary. The ordinary clickable link remains usable during generation and after
failure. Thumbnail support is deferred. The preview does not fetch images or run page scripts.

The Worker uses an isolated fetch path with restricted network egress. Validate the resolved
destination and every redirect before connecting. Keep the validated address bound to the
connection and deny access to private, local, and infrastructure destinations. Apply bounded
response sizes, redirect counts, concurrency, and deadlines. Fetch without account credentials
or cookies. Publish sanitized text only under the current job lease and the matching message
version and URL. Editing the link, disabling the preview, deleting the message, or letting it
expire invalidates earlier work. A preview failure never blocks sending.

## Acceptance

- Two sessions converge on committed vote and checklist updates. Concurrent vote replacement
  counts each account once. Hidden results, anonymous identities, and quiz answers stay out of
  unauthorized responses. A channel subscriber cannot identify another subscriber through a poll
  or checklist. Independent task updates succeed and conflicting updates are reported.
- Protected or inaccessible sources cannot be forwarded. Destination retries produce one batch
  per destination and preserve its draft. A forwarded attachment stays downloadable after source
  deletion and a collection pass. Forwarded interactive snapshots contain only allowed fields.
- English and Chinese searches use literal matching. Short searches stay within their work
  budget. Filters, date anchors, pins, and media pages keep the history permission boundary.
  A distant hit opens through a bounded neighborhood, and revoked hits cannot be reopened.
- A link displays its text preview or remains a plain link. Unsafe destinations and stale jobs
  produce no preview. Tests exercise redirect and DNS boundaries and send, edit, and delete races.
- Bundled stickers and contact cards round-trip through acceptance, history, and sync. Unknown
  assets and unselected private contact fields never reach a recipient.

Choose request names, schema details, and measured size and work limits in the implementation
plan. Use the existing commands, history, and sync tests for behavior they already cover.

[roadmap]: ../plans/2026-11-08-product-milestones.md#m7-complete-message-interactions-and-history-discovery
[product]: 2026-11-08-complete-product-design.md
