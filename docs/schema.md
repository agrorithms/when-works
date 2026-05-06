### Database Schema (Supabase)

The app uses five main tables:

1. **events** - Event metadata (title, description, date ranges, blocked dates, deadline, availability visibility)
2. **responses** - Respondent availability (name, display_name, response_type: available/unavailable, dates array, confirmed status, includes_so boolean)
3. **event_ownerships** - Event access control (links events to owner_user_id or owner_email, manage_token for private links)
4. **event_followups** - Hosting rounds (selected_date, timezone, status: draft/open/closed, calendar sync fields)
5. **event_followup_invites** - Tokenized invites for follow-up coordination (links responses to followups with unique invite_tokens)
6. **event_followup_answers** - Hosting responses (still_available boolean, preferred_start_time)

All tables use RLS (Row Level Security) allowing public read/write for events and responses, while event_ownerships requires authorization.

7. **user_profiles** - Per-user preferences for signed-in users (display_name override, default_timezone)
   - Keyed by normalized `email` (unique), with nullable `google_user_id` (Google sub) for dual-key identity — mirrors the `event_ownerships` pattern so email-claimed accounts that later sign in with Google work correctly.
   - `display_name`: null means fall back to Google profile name.
   - `default_timezone`: IANA timezone string (e.g. `America/New_York`); null until first profile visit, seeded from browser detection.
   - `date_format`: `'us'` (MM/DD/YYYY) | `'eu'` (DD/MM/YYYY) | `'iso'` (YYYY-MM-DD); null = not set (stored only, not yet applied app-wide).
   - `time_format`: `'auto'` (browser locale) | `'12h'` | `'24h'`; null = not set (stored only, not yet applied app-wide).
   - Row is upserted on every Google sign-in via the next-auth `signIn` callback in `lib/auth.js`. Existing `display_name`/`default_timezone` are not overwritten on upsert.
   - All reads/writes go through service-role API routes (`app/api/profile/route.js`, `app/api/settings/`); RLS denies all public access.
