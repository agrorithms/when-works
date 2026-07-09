### Request Flow & Access Patterns

All database access is server-side via the service-role client (`lib/supabaseAdmin.js`). RLS denies the anon role on every table (`supabase/migrations/002_drop_public_policies.sql`, `003_participants.sql`); the browser never talks to Supabase directly.

**Identity model**: every person is a `participants` row (`lib/participants.js`). Signed-in users resolve by normalized session email; guests by the device-wide `participant_token` capability (global localStorage key `when_works_participant_token`, shared across all events). The legacy per-event `response_token` still resolves indefinitely.

**Public Event Response Path** (`/respond/[slug]`, backed by `/api/respond/[slug]`):
- `GET` returns the event (sanitized fields only), weighted attendee count, and — when `show_availability_counts` — confirmed responses stripped to `{id, response_type, dates, includes_so}` (no names, emails, or tokens). Soft-deleted responses are excluded everywhere.
- `POST` resolution order (all lookups filter `deleted_at is null`; signed-in always wins over tokens — shared computers):
  1. Session email → participant → active response by `(event_id, participant_id)`
  2. `body.memberToken` (group member link `?m=`) → active `group_members` row → member's participant → active response. Beats the device token: the link carries explicit identity, the device token is ambient.
  3. `body.participantToken` → participant → active response
  4. Legacy `body.responseToken` → active response by `response_token`
- Claim rules after resolution: signed-in + token-resolved row → repoint `participant_id` to the email participant (safe: step 1 proved it has no active row here). Guest + member-token row → the member participant's token is returned so the device adopts the member identity. Guest + legacy-token row with null `participant_id` → attach the device participant. A legacy-token row that already belongs to a participant hands that participant's token back so the device adopts it. Signed-in + memberToken whose roster participant is an email-less placeholder → the roster row is repointed to the session participant (email members are never auto-repointed).
- `action:'start'` resolves-or-creates. Participants are only ever CREATED here (signed-in: on-demand upsert; guest: new participant when no token matches — a valid memberToken uses the member's participant instead, and seeds the roster name when none is typed). `start` with `resolveOnly: true` is the page-load probe — it never creates, so viewing an event never mints an empty response; with a valid memberToken it returns `member: {display_name}` for the name prefill. Responses return `participant_token` only; `memberToken`/legacy `response_token` are accepted in request bodies but never returned.
- `action:'save'` / `action:'hosting_info'` only resolve (claims with existing participants still apply on save); save applies validated partial updates (dates within range, blocked dates stripped)
- **Token-only identity**: typing a name never claims an existing response; duplicate names create separate responses. A NEW respondent typing an already-taken name gets a server-assigned numbered suffix ("Louis A (2)"; case-insensitive on `name`; soft-deleted rows count as taken); a returning respondent (token-resolved) re-saving their own name is excluded from the check and keeps it

**Follow-up Path** (`/followup/[token]`, backed by `/api/followup/[inviteToken]`):
- The `invite_token` is the capability; GET returns invite + round + event title + existing answer, POST upserts the validated answer

**Creator Access** (`/events/manage/[token]` and `/events/new`):
- Google OAuth via next-auth (scope: calendar.events for future integrations)
- Private owner link: generated as manage_token in event_ownerships, saved to browser localStorage automatically on creation
- `POST /api/events` writes `event_ownerships.participant_id` (google mode via `ensureParticipantForSession`; link mode from the optional `body.participantToken` the create page sends)
- Owner-side response soft delete/restore lives on `/api/events/manage/[token]` (`delete_response`, `restore_response`; restore against a newer active duplicate → 409). The owner bundle exposes `has_email` per response but never emails or tokens.
- Legacy rows with access_mode = 'email' have no owner identity anymore (owner_email was dropped with 005); they remain reachable only via `manage_token` or the admin override

**Groups** (`/groups` and `/groups/manage/[ref]`, backed by `/api/groups` + `/api/groups/manage/[ref]`):
- Access mirrors events: `resolveGroupAccess` (`lib/groups.js`) tries the admin `x-admin-password` header (group id), then the Google session (participant must equal `groups.owner_participant_id`), then `manage_token`. Link-mode manage tokens are saved to localStorage (`when_works_group_tokens`).
- The owner bundle exposes members as `{id, display_name, invited_email, member_token, removed_at, created_at, has_email}` plus computed score/attendedCount — `member_token` is deliberately owner-visible (it's how the host copies personal links), but `participants.email` and anyone's `participant_token` never appear. Event responses in the bundle are `{id, display_name, confirmed}` only.
- `POST /api/events` accepts `groupRef`; group access is verified BEFORE the insert, the event gets `group_id`, and active members with an `invited_email` are emailed their `?m=` link (best-effort; Resend via `lib/email.js`).
- `POST /api/me/pending` (session-first, else `body.participantToken`) returns group events awaiting the caller's response — only the caller's OWN member tokens ride along. Powers the home/events banner (`components/PendingGroupEvents.js`).
- Attendance is hybrid: auto = active confirmed response covering the latest hosting round's `selected_date` (a `still_available: false` followup answer flips it), host overrides + response-links live in `group_event_attendance`. Score = Σ `0.5^(days_since/90)` over attended events, computed at read time (`lib/groupAttendance.js`).

**Admin Dashboard** (`/admin/*`):
- Password checked server-side per request: `x-admin-password` header vs server-only `ADMIN_PASSWORD` (`lib/adminAuth.js`, timing-safe compare). Login validated via `POST /api/admin/login`; the password is kept in sessionStorage and attached to admin API calls
- `GET /api/admin/events` lists all events + active responses; event detail reuses `/api/events/manage/[ref]` via the admin override in `resolveOwnership`
- Admin event creation goes through `POST /api/events` with `access_mode: 'link'` (creates a real ownership row + manage token)

### API Authorization Pattern

The backend uses a unified ownership check (`lib/ownership.js` → resolveOwnership):
- Admin override: valid `x-admin-password` header resolves any event by id
- Google session path: the session's participant must match `ownership.participant_id`
- manage_token (private link) path unchanged
- Returns 403 if no match, allows mutations if match found
