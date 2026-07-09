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
   - `response_token` uuid — the legacy per-event guest edit capability. Still accepted in request bodies indefinitely (old browsers hold per-slug localStorage keys) and adopted into the visitor's device participant on next visit; never returned in payloads or written client-side.
4. **event_ownerships** - Event access control (`participant_id` → participants is THE owner identity; `manage_token` for private links)
5. **event_followups** - Hosting rounds (selected_date, timezone, status: draft/open/closed, calendar sync fields)
6. **event_followup_invites** - Tokenized invites for follow-up coordination (links responses to followups with unique invite_tokens)
7. **event_followup_answers** - Hosting responses (still_available boolean, preferred_start_time)
8. **groups** - Named friend groups (see `supabase/migrations/006_groups.sql`)
   - `cadence_days` integer (7/14/30/60/90 presets, null = none) drives the read-time "plan the next one" nudge.
   - Ownership is inline (no join table): `access_mode 'google'|'link'`, `owner_participant_id` → participants, `manage_token` (32-hex, link mode only). Resolved by `resolveGroupAccess` in `lib/groups.js` (admin header / session participant / manage_token — same order as events).
9. **group_members** - Group roster
   - `participant_id` NOT NULL → participants (email members resolve-or-create by normalized email; no-email members get a fresh guest participant — there are no participant-less members).
   - `member_token` uuid unique — the per-member invite-link capability (`/respond/[slug]?m=…`). Owner-visible in the group bundle (possession = respond-as-member; accepted threat model).
   - `invited_email` — normalized snapshot of what the host typed; shown to the owner instead of `participants.email`, which is never returned.
   - `removed_at` soft remove; partial unique index enforces one ACTIVE membership per (group_id, participant_id).
10. **group_event_attendance** - ONLY host overrides + host response-links, one row per (event_id, member_id)
   - `attended_override` boolean nullable (null = auto applies), `linked_response_id` → responses (counts an anonymous response as a member without repointing `responses.participant_id`).
   - The auto attended value and the recency-weighted score (`0.5^(days/90)`, `lib/groupAttendance.js`) are computed at read time, never stored.

`events.group_id` (nullable → groups, set null on delete) links group-planned events; `POST /api/events` with `groupRef` sets it and emails members their `?m=` links via Resend (`lib/email.js`, no-op without env).

All tables have RLS enabled with NO public policies (see `supabase/migrations/002_drop_public_policies.sql` and 003 for participants) — the anon role can read/write nothing. All access goes through service-role API routes.

Migration state: 001–005 have all run. 005 dropped the legacy identity surfaces (`responses.google_email`, `event_ownerships.owner_user_id`/`owner_email`, the `user_profiles` table) — code must never reference them. IMPORTANT: 005 and the cleanup code deploy must land together; code that writes the dropped columns errors against the post-005 schema. 006 (groups) is additive-only and must run BEFORE the groups code deploys.
