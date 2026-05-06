### Request Flow & Access Patterns

**Public Event Response Path** (`/respond/[slug]`):
- Fetch event by slug (public read)
- Create or retrieve response record by name + event_id (auto-generates guest numbers if unnamed)
- Track availability selections in refs, auto-save to DB every 2 seconds
- Support toggle between "available" and "unavailable" modes
- Show availability counts from confirmed responses if event.show_availability_counts is true

**Creator Access** (`/events/manage/[token]` and `/events/new`):
- Google OAuth via next-auth (scope: calendar.events for future integrations)
- Email claim: user enters email post-creation, system links ownership to account
- Private owner link: generated as manage_token in event_ownerships, saved in browser localStorage
- Three access paths merged: session.user.id, normalized session.user.email, or manage_token

**Admin Dashboard** (`/admin/*`):
- Session-based auth using sessionStorage (password: NEXT_PUBLIC_ADMIN_PASSWORD)
- Read-only access to all events and responses
- Create events, set blocked dates, manage deadlines
- Launch hosting follow-up rounds

### API Authorization Pattern

The backend uses a unified ownership check (resolveOwnership):
- Looks up event_ownerships record
- Verifies owner_user_id (Google session) OR owner_email (normalized, claimed email) OR owner_token (manage_token)
- Returns 403 if no match, allows mutations if match found
- Updates owner_user_id when email-claimed user signs in (consolidates access methods)