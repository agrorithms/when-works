### Database Schema (Supabase)

The app's main tables:

1. **participants** - First-class identity across events (see `supabase/migrations/003_participants.sql`)
   - `id` uuid pk; `participant_token` uuid unique — the device-wide guest capability, stored in the browser's global localStorage key `when_works_participant_token` and never shown in owner/admin payloads.
   - `email` unique nullable, always normalized (trim + lowercase); null for guests. Signed-in users resolve by email, guests by token.
   - `google_user_id` (Google sub) — informational only, deliberately NOT unique (a Google account's email can change) and never a lookup key.
   - Preference columns absorbed from the old `user_profiles` table: `display_name` (signed-in default only — responses keep their own names), `default_timezone`, `date_format` (`'us'`|`'eu'`|`'iso'`), `time_format` (`'auto'`|`'12h'`|`'24h'`).
   - Row is upserted on every Google sign-in via the next-auth `signIn` callback in `lib/auth.js` (fire-and-forget: participant-keyed routes tolerate a missing row via `ensureParticipantForSession`). Existing prefs are not overwritten on upsert.
2. **events** - Event metadata (title, description, date ranges, blocked dates, deadline, availability visibility, allow_plus_one boolean)
3. **responses** - Respondent availability (name, display_name, response_type: available/unavailable, dates array, confirmed status, includes_so boolean)
   - `participant_id` → participants (on delete set null). Partial unique index `responses_event_participant_active_idx` enforces one ACTIVE response per participant per event (null participant_id exempt).
   - `deleted_at` — owner-side soft delete. Deleted rows are excluded from all counts, public payloads, hosting rounds, and respondent resolution; they are restorable from the owner page (restore conflicts with a newer active row → 409).
   - `response_token` uuid — the legacy per-event guest edit capability. Still resolved indefinitely (old browsers hold per-slug localStorage keys) and adopted into the visitor's device participant on next visit; no longer written client-side.
   - `google_email` — LEGACY, dual-written (normalized) until `005_cleanup_legacy_identity.sql`; identity lives on the participant.
4. **event_ownerships** - Event access control (`participant_id` → participants is the identity going forward; `owner_user_id`/`owner_email` are legacy dual-writes until 005; `manage_token` for private links)
5. **event_followups** - Hosting rounds (selected_date, timezone, status: draft/open/closed, calendar sync fields)
6. **event_followup_invites** - Tokenized invites for follow-up coordination (links responses to followups with unique invite_tokens)
7. **event_followup_answers** - Hosting responses (still_available boolean, preferred_start_time)
8. **user_profiles** - LEGACY, superseded by participants. Dropped by `005_cleanup_legacy_identity.sql` after the post-deploy soak.

All tables have RLS enabled with NO public policies (see `supabase/migrations/002_drop_public_policies.sql` and 003 for participants) — the anon role can read/write nothing. All access goes through service-role API routes.

Migration state: 003 (schema) and 004 (re-runnable backfill of email identities; guests adopt lazily) run before the participants code deploys; 004 re-runs after the deploy to catch the window; 005 (destructive column/table drops) runs only after verification + soak, together with the cleanup code PR that removes dual-writes and legacy fallbacks.
