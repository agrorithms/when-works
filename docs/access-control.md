### Request Flow & Access Patterns

All database access is server-side via the service-role client (`lib/supabaseAdmin.js`). RLS denies the anon role on every table (`supabase/migrations/002_drop_public_policies.sql`, `003_participants.sql`); the browser never talks to Supabase directly.

**Identity model**: every person is a `participants` row (`lib/participants.js`). Signed-in users resolve by normalized session email; guests by the device-wide `participant_token` capability (global localStorage key `when_works_participant_token`, shared across all events). The legacy per-event `response_token` still resolves indefinitely.

**Public Event Response Path** (`/respond/[slug]`, backed by `/api/respond/[slug]`):
- `GET` returns the event (sanitized fields only), weighted attendee count, and — when `show_availability_counts` — confirmed responses stripped to `{id, response_type, dates, includes_so}` (no names, emails, or tokens). Soft-deleted responses are excluded everywhere.
- `POST` resolution order (all lookups filter `deleted_at is null`; signed-in always wins over device tokens — shared computers):
  1. Session email → participant → active response by `(event_id, participant_id)`
  2. `body.participantToken` → participant → active response
  3. Legacy `body.responseToken` → active response by `response_token`
- Claim rules after resolution: signed-in + token-resolved row → repoint `participant_id` to the email participant (safe: step 1 proved it has no active row here). Guest + legacy-token row with null `participant_id` → attach the device participant. A legacy-token row that already belongs to a participant hands that participant's token back so the device adopts it.
- `action:'start'` resolves-or-creates. Participants are only ever CREATED here (signed-in: on-demand upsert; guest: new participant when no token matches). `start` with `resolveOnly: true` is the page-load probe — it never creates, so viewing an event never mints an empty response. Responses return both `response_token` (until the post-005 cleanup) and `participant_token`.
- `action:'save'` / `action:'hosting_info'` only resolve (claims with existing participants still apply on save); save applies validated partial updates (dates within range, blocked dates stripped)
- **Token-only identity**: typing a name never claims an existing response; duplicate names create separate responses. A NEW respondent typing an already-taken name gets a server-assigned numbered suffix ("Louis A (2)"; case-insensitive on `name`; soft-deleted rows count as taken); a returning respondent (token-resolved) re-saving their own name is excluded from the check and keeps it
- `google_email` (legacy dual-write, normalized) is only ever set server-side from the NextAuth session — never from client input

**Follow-up Path** (`/followup/[token]`, backed by `/api/followup/[inviteToken]`):
- The `invite_token` is the capability; GET returns invite + round + event title + existing answer, POST upserts the validated answer

**Creator Access** (`/events/manage/[token]` and `/events/new`):
- Google OAuth via next-auth (scope: calendar.events for future integrations)
- Private owner link: generated as manage_token in event_ownerships, saved to browser localStorage automatically on creation
- `POST /api/events` writes `event_ownerships.participant_id` (google mode via `ensureParticipantForSession`; link mode from the optional `body.participantToken` the create page sends) and dual-writes the legacy `owner_user_id`/`owner_email` columns until 005
- Owner-side response soft delete/restore lives on `/api/events/manage/[token]` (`delete_response`, `restore_response`; restore against a newer active duplicate → 409). The owner bundle exposes `has_email` per response but never emails or tokens.
- Legacy: rows with access_mode = 'email' still resolve via normalized owner_email match when a Google session signs in, but new events cannot be created with this mode

**Admin Dashboard** (`/admin/*`):
- Password checked server-side per request: `x-admin-password` header vs server-only `ADMIN_PASSWORD` (`lib/adminAuth.js`, timing-safe compare). Login validated via `POST /api/admin/login`; the password is kept in sessionStorage and attached to admin API calls
- `GET /api/admin/events` lists all events + active responses; event detail reuses `/api/events/manage/[ref]` via the admin override in `resolveOwnership`
- `GET /api/admin/unlinked` is the pre-005 sanity report (ownerships/responses the backfill couldn't link, unclaimed guest count), surfaced as the collapsed "Unlinked identities" panel on `/admin/events`
- Admin event creation goes through `POST /api/events` with `access_mode: 'link'` (creates a real ownership row + manage token)

### API Authorization Pattern

The backend uses a unified ownership check (`lib/ownership.js` → resolveOwnership):
- Admin override: valid `x-admin-password` header resolves any event by id
- Google session path: the session's participant must match `ownership.participant_id`; legacy fallbacks (normalized `owner_email`, `owner_user_id === session.user.id`) apply until the post-005 cleanup PR, and any legacy hit claims the row by writing `participant_id`
- manage_token (private link) path unchanged
- Returns 403 if no match, allows mutations if match found
