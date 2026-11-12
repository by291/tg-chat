# Private media

Connected mode sends photos, photo and video albums, videos, documents, and recorded voice
messages. Profile and community avatars use the same private upload and processing pipeline.
An album contains up to ten ordered photos and videos with one caption. A document or voice
recording is sent individually. A caption can be edited through the message's versioned edit
command after sending.

## Sending and recovery

Send commits the source Blobs, ordered occurrences, and message identity to IndexedDB before
starting a transfer. The pending message remains in the conversation with upload or processing
progress. Reopening the same browser and authenticated session restores the operation. The
browser asks storage which parts committed and sends only the missing parts. An interrupted
single PUT reconciles completion before retransmitting. Tabs share the session transfer budget
through a Web Lock or an expiring IndexedDB lease. Files persist with the pending operation for
at most seven days. If the queue entry survives without its source, reselecting the original
requires its matching fingerprint before the app can reuse its uploaded parts.

PostgreSQL reserves account and deployment capacity before issuing exact-size writes to private
S3 staging. A completed upload queues a Worker job. The Worker copies the staged bytes into a
unique server-owned namespace, checks the copy against the reservation, and prepares bounded
variants. A staging signature may still permit an overwrite, so the Worker validates the copied
candidate before publishing its immutable bytes. Codec subprocesses run with restricted protocols,
no network, and process limits. Only the current lease can publish the ready file and its metadata.

The send transaction applies current posting permissions and commits all ordered file references
with the message. A lost response reuses the same message and operation IDs. The recipient
sees one accepted message. If the server definitively rejects the send because its ready file
expired, **Send again** keeps the caption and prepares a new send. Upload and processing failures
leave independent text sends usable.

## Reading and retention

Message media reads check the current conversation and the specific occurrence. Avatar reads
follow profile or community metadata visibility and expose only the thumbnail. Original files
download as attachments. The media origin strips application cookies and adds `nosniff`.
Video and audio use Range requests where supported. Signed URLs stay in mounted view state and
expire after one minute by default. Revocation prevents new signatures. Already issued URLs
can remain usable until their expiration.

A reference or a pending ready hold keeps the immutable bytes alive. The collector takes the
same file lock used when adding references, checks current references again, and marks the file
deleting before touching storage. Failed physical deletions retry, and quota remains charged
until cleanup finishes. Abandoned multipart uploads, staging objects, and stale attempts are
collected after their write and processing windows.

## Report evidence

A report captures the currently authorized message and references only the original attachments
on that message, including a reported forward's own occurrences. Related messages and restricted
interaction results are excluded from the snapshot. A repeat report by the same account for the
same message keeps the original case and deadline. Case references preserve the immutable originals
after source removal. The collector can release derivatives once ordinary references and ready
holds end.

Originals are available through the case download route to operators with current authority
and recent password proof. The route streams bytes as an attachment and audits access.
Evidence expires after 90 days by default. An operator can extend an open case before expiry
through an audited command. Closing a case keeps its current deadline. At the deadline, reads
stop and the Worker releases case references in bounded transactions. Remaining ordinary
references and holds determine when the object becomes eligible for physical deletion.

## Operating the feature

For an existing local environment, set `TG_CHAT_MEDIA_ENABLED=true` and apply the current
migrations before restarting the API and Worker. The browser-facing endpoint must point to
the media origin. Use a separate cookie-free hostname and HTTPS for deployment. Keep the
internal RustFS address private. See [operations](operations.md#persistence-and-recovery)
for coordinated PostgreSQL and RustFS backup and restore.

Use the [development guide](development.md#repeatable-verification) for repeatable integration
and browser checks.
