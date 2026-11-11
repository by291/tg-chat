# Accounts, privacy, and recovery

The account service establishes identity before real messaging is connected. PostgreSQL is the
authority for credentials, sessions, private profiles, relationships, challenges, and mail intent.
Valkey holds expiring admission counters. The API commits business changes; the Worker delivers
mail outside those transactions. The frontend consumes generated OpenAPI contracts over the same
origin. [Development](./development.md) covers setup and repeatable verification;
[operations](./operations.md) covers trusted administration and recovery.

## Identity and credential changes

Registration uses an immutable, case-insensitive ASCII username and password. Display name,
biography, and optional private phone text are independent fields. Phone text is neither a login
identifier nor a public directory field. An optional email becomes a recovery address only after
verification; it is private and unique among verified accounts.

Argon2id hashes passwords with bounded blocking concurrency. Passwords support Unicode and are
never trimmed or truncated. Configuration may raise memory and iteration costs within supported
bounds; the owning settings module defines defaults. Unknown-user login performs dummy verification
so missing identities do not skip password work.

Password verification runs outside database locks. Admission then locks the user and rechecks the
credential version and suspension status before creating a session. This prevents a slow, successful
verification of an old password from admitting a session after a password change or suspension.
Registration locks the policy row so closing registration and admitting accounts have a defined order.

Password changes rotate the current cookie and revoke every old session. Recovery revokes all
sessions and requires a fresh login. Suspension also invalidates sessions and challenges; restoring
an account never revives them. Privileged CLI actions commit append-only audit entries with their
changes. The future M8 UI must preserve these transaction boundaries.

## Session and request ownership

Opaque, random session tokens live only in HttpOnly cookies; PostgreSQL stores domain-separated
hashes. Every authenticated API request checks the session and current account status in PostgreSQL.
Absolute and idle expiry are separate. Device activity writes are coalesced, while sensitive changes
recheck session validity inside the transaction. Password, email, and peer-device changes require
recent password proof. Self-logout stays available without reauthentication.

Unsafe requests require the exact configured Origin and `X-TG-Chat-Request: 1`. Authenticated writes
also require `X-CSRF-Token`, derived from the current session and returned with its authenticated
snapshot. Duplicate session cookies are rejected. Cookies use SameSite=Lax and the HTTPS `__Host-`
boundary, with a distinct loopback-only HTTP development exception. The gateway overwrites the
dedicated client-IP header; direct native requests use their socket peer unless explicitly configured.

Registration, login, recovery, and discovery are bounded through atomic Valkey counters. Keys hash
identity text instead of storing raw usernames or email. Limiter failure rejects sensitive admission
but does not disable existing authenticated reads. JSON size, directory pages, password work, and
relationship capacity have independent bounds. Account responses use `Cache-Control: no-store`.
Errors contain safe machine codes, a user-facing message, and a server-generated request ID.

The connected frontend keeps its session snapshot and private results in memory. An ownership
generation fences delayed responses, including delayed response bodies. Logout, password rotation,
and account switches cancel old work; another tab receives an invalidation signal without account
data or tokens. Focus and periodic session refresh detect peer revocation. A resource whose scope
changes hides its prior results before starting the next request. Demo stores are loaded only in
explicit demo mode and never become connected account state.
Within one account, profile versions merge monotonically so delayed refreshes or older write replies
cannot replace newer saved fields. Version ordering uses integers without JavaScript precision loss.

## Profiles, contacts, and blocks

Owner profile updates carry an expected version to reject lost edits. Public projections contain
only identity, username, display name, and biography. Email, phone, device details, and privacy
settings never enter directory responses. Discovery requires authentication and a nontrivial query,
omits suspended identities, and uses bounded opaque-cursor pages.
Existing saved contacts and blocks remain visible after a target is suspended so their owner can
still remove them and reclaim capacity.

Contacts and blocks are directional. Adding a contact does not add the actor to the other person's
list. A block preserves existing saved contacts but prevents new contact admission across either
direction. Both participants are locked in UUID order before checking blocks, limits, or
foreign keys, avoiding reciprocal lock inversion and block/contact races. Future direct messaging,
calls, and presence must consult these relationships and independent audience settings; M2 stores
the policy but does not pretend that those later services already exist.

## Email challenges and durable mail

Email replacement preserves the old verified address until the new address is confirmed. Confirmation
locks the account and challenge, checks credential/email versions and expiry, and commits unique
ownership atomically. Removing an address or changing credentials invalidates outstanding links.
Recovery admission gives the same generic response for known and unknown addresses; it reserves
queue capacity before identity lookup to avoid an enumeration difference under pressure.

Challenge hashes and encrypted mail jobs commit together. AES-GCM payloads bind the job UUID as
authenticated context, so copying ciphertext to another job cannot create a valid delivery.
Links put secrets in fragments, which the browser removes before submitting the token in JSON.
Opening a verification URL alone does not consume it; the user confirms the action. Expired,
consumed, or stale-version links fail, and concurrent consumers cannot apply the action twice.

Workers claim due jobs with `SKIP LOCKED` and a fresh lease token. Before decrypting or sending,
they check that the lease, account, and challenge are still eligible. SMTP uses a bounded timeout
shorter than the lease and never holds business locks. Completion/retry requires the same unexpired
lease, so an old Worker cannot complete a reclaimed claim. Attempts and backoff are bounded;
even a crash during the last attempt eventually becomes exhausted instead of creating endless claims.

Delivery is at-least-once across an ambiguous SMTP success/crash. An address may receive a duplicate
or a link invalidated while SMTP is already in flight; only the single-use database transaction can
change the account. Sent/discarded jobs erase payload bytes. Exhausted jobs retain encrypted payloads
for operator diagnosis; automatic terminal-row retention and replay are not part of M2.

When SMTP is absent, capabilities explicitly disable new verification and recovery requests. They
never report a fake send success. Durable intent survives process restarts, but the mail key must
survive with it; [operations](./operations.md#mail-delivery-and-protected-payloads) explains retention.

## Remaining product boundaries

[Private media](media.md) owns validated avatar uploads. M8 owns the administration UI, account
deletion, and broader lifecycle operations. LiveKit one-to-one calls remain a separate milestone.
The `/demo` route keeps its own sample accounts and messages.
