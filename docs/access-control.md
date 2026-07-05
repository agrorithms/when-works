### Request Flow & Access Patterns

All database access is server-side via the service-role client (`lib/supabaseAdmin.js`). RLS denies the anon role on every table (`supabase/migrations/002_drop_public_policies.sql`); the browser never talks to Supabase directly.

**Public Event Response Path** (`/respond/[slug]`, backed by `/api/respond/[slug]`):
- `GET` returns the event (sanitized fields only), weighted attendee count, and — when `show_availability_counts` — confirmed responses stripped to `{id, response_type, dates, includes_so}` (no names, emails, or tokens)
- `POST action:'start'` resolves-or-creates the visitor's response: signed-in users match by server-verified `google_email`, guests by their `response_token`; otherwise a new row is created (server-side guest numbering). Returns the row including its `response_token`, which the client stores in localStorage (`when_works_response_token_<slug>`)
- `POST action:'save'` requires the `response_token` (or a signed-in email match) and applies validated partial updates (dates within range, blocked dates stripped)
- `POST action:'hosting_info'` returns the open round + the caller's invite token
- **Token-only identity**: typing a name never claims an existing response; duplicate names create separate responses
- `google_email` is only ever set server-side from the NextAuth session — never from client input

**Follow-up Path** (`/followup/[token]`, backed by `/api/followup/[inviteToken]`):
- The `invite_token` is the capability; GET returns invite + round + event title + existing answer, POST upserts the validated answer

**Creator Access** (`/events/manage/[token]` and `/events/new`):
- Google OAuth via next-auth (scope: calendar.events for future integrations)
- Private owner link: generated as manage_token in event_ownerships, saved to browser localStorage automatically on creation
- Two access paths: session.user.id (Google) or manage_token (private link)
- Legacy: rows with access_mode = 'email' still resolve via normalized owner_email match when a Google session signs in, but new events cannot be created with this mode

**Admin Dashboard** (`/admin/*`):
- Password checked server-side per request: `x-admin-password` header vs server-only `ADMIN_PASSWORD` (`lib/adminAuth.js`, timing-safe compare). Login validated via `POST /api/admin/login`; the password is kept in sessionStorage and attached to admin API calls
- `GET /api/admin/events` lists all events + responses; event detail reuses `/api/events/manage/[ref]` via the admin override in `resolveOwnership`
- Admin event creation goes through `POST /api/events` with `access_mode: 'link'` (creates a real ownership row + manage token)

### API Authorization Pattern

The backend uses a unified ownership check (`lib/ownership.js` → resolveOwnership):
- Admin override: valid `x-admin-password` header resolves any event by id
- Verifies owner_user_id (Google session) OR owner_email (normalized, claimed email) OR manage_token (private link)
- Returns 403 if no match, allows mutations if match found
- Updates owner_user_id when a Google user's email matches a legacy owner_email row (consolidates access)