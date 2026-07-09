### Database Schema (Supabase)

The app's main tables:

1. **participants** - First-class identity across events (see `supabase/migrations/003_participants.sql`)
   - `id` uuid pk; `participant_token` uuid unique — the device-wide guest capability, stored in the browser's global localStorage key `when_works_participant_token` and never shown in owner/admin payloads.
   - `email` unique nullable, always normalized (trim + lowercase); null for guests. Signed-in users resolve by email, guests by token.
   - `google_user_id` (Google sub) — informational only, deliberately NOT unique (a Google account's email can change) and never a lookup key.
   - Preference columns absorbed from the old `user_profiles` table: `display_name` (signed-in default only — responses keep their own names), `default_timezone`, `date_format` (`'us'`|`'eu'`|`'iso'`), `time_format` (`'auto'`|`'12h'`|`'24h'`).
   - Row is upserted on every Google sign-in via the next-auth `signIn` callback in `lib/auth.js` (fire-and-forget: participant-keyed routes tolerate a missing row via `ensureParticipantForSession`). Existing prefs are not overwritten on upsert.
2. **events** - Event metadata (title, description, date ranges, blocked dates, deadline, availability visibility, allow_plus_one boolean)
   - `created_by_schedule_id` (nullable → group_schedules, set null) — provenance of auto-created group polls; used by the cron's duplicate-create guard and the pre-send "previous poll unresolved" check.
   - `owner_summary_sent_at` — the ONE owner-summary marker per group poll, shared by the all-responded hook (respond route) and the deadline cron task. Whichever fires first claims it with a compare-and-set update; the other then skips. Never send a summary without claiming it first.
3. **responses** - Respondent availability (name, display_name, response_type: available/unavailable, dates array, confirmed status, includes_so boolean)
   - `participant_id` → participants (on delete set null). Partial unique index `responses_event_participant_active_idx` enforces one ACTIVE response per participant per event (null participant_id exempt).
   - `deleted_at` — owner-side soft delete. Deleted rows are excluded from all counts, public payloads, hosting rounds, and respondent resolution; they are restorable from the owner page (restore conflicts with a newer active row → 409).
   - `response_token` uuid — the legacy per-event guest edit capability. Still accepted in request bodies indefinitely (old browsers hold per-slug localStorage keys) and adopted into the visitor's device participant on next visit; never returned in payloads or written client-side.
4. **event_ownerships** - Event access control (`participant_id` → participants is THE owner identity; `manage_token` for private links)
5. **event_followups** - Hosting rounds (selected_date, timezone, status: draft/open/closed, calendar sync fields)
6. **event_followup_invites** - Tokenized invites for follow-up coordination (links responses to followups with unique invite_tokens)
7. **event_followup_answers** - Hosting responses (still_available boolean, preferred_start_time)
8. **groups** - Named friend groups (see `supabase/migrations/006_groups.sql`, cadence reshaped by `007_group_scheduling.sql`)
   - Hybrid cadence: `cadence_unit 'day'|'month'` + `cadence_interval` (day: 7/14; month: 1/2/3) + `cadence_anchor_day` (1–31, month unit only, clamped to month length at use). Drives the read-time nudge AND the automation schedule. Presets/validation live in `lib/schedule.js` (`CADENCE_PRESETS`, `validateCadence`).
   - `cadence_days` is DEPRECATED (backfilled into the hybrid columns by 007, dropped by a later 008) — never reference it in new code.
   - Ownership is inline (no join table): `access_mode 'google'|'link'`, `owner_participant_id` → participants, `manage_token` (32-hex, link mode only). Resolved by `resolveGroupAccess` in `lib/groups.js` (admin header / session participant / manage_token — same order as events).
9. **group_members** - Group roster
   - `participant_id` NOT NULL → participants (email members resolve-or-create by normalized email; no-email members get a fresh guest participant — there are no participant-less members).
   - `member_token` uuid unique — the per-member invite-link capability (`/respond/[slug]?m=…`). Owner-visible in the group bundle (possession = respond-as-member; accepted threat model).
   - `invited_email` — normalized snapshot of what the host typed; shown to the owner instead of `participants.email`, which is never returned.
   - `removed_at` soft remove; partial unique index enforces one ACTIVE membership per (group_id, participant_id).
10. **group_event_attendance** - ONLY host overrides + host response-links, one row per (event_id, member_id)
   - `attended_override` boolean nullable (null = auto applies), `linked_response_id` → responses (counts an anonymous response as a member without repointing `responses.participant_id`).
   - The auto attended value and the recency-weighted score (`0.5^(days/90)`, `lib/groupAttendance.js`) are computed at read time, never stored.
11. **group_schedules** - Automatic recurring polls, at most one per group (`unique(group_id)`, see `007_group_scheduling.sql`)
   - Config: `excluded_weekdays int[]` (0=Sun..6=Sat, blocked in every generated poll), `send_day_of_month` (month cadence, 1–27 enforced in app), `lead_days` (day cadence), `deadline_days` (poll deadline = send + N, always clamped before the window), `notify_email` (required — owner summaries/notices go here).
   - Cursor: `next_window_start/next_window_end/next_send_on` — THE idempotency anchor. The daily cron claims an occurrence by advancing the cursor with a compare-and-set on `next_send_on`; a double-fired cron can never create two polls. Month windows always start on a month's day 1.
   - `pause_token` (32-hex unique) — one-click pause capability mailed in pre-send notices (`/groups/pause/[token]`, POST-only mutation). `paused_at` set = cron skips; resume re-anchors to the next future period (never catch-up fires).
   - `presend_notice_sent_for` / `last_sent_on` / `last_sent_event_id` / `last_error` — cron bookkeeping.

`events.group_id` (nullable → groups, set null on delete) links group-planned events; `POST /api/events` with `groupRef` sets it and emails members their `?m=` links via Resend (`lib/email.js`, no-op without env).

All tables have RLS enabled with NO public policies (see `supabase/migrations/002_drop_public_policies.sql` and 003 for participants) — the anon role can read/write nothing. All access goes through service-role API routes.

Migration state: 001–005 have all run. 005 dropped the legacy identity surfaces (`responses.google_email`, `event_ownerships.owner_user_id`/`owner_email`, the `user_profiles` table) — code must never reference them. IMPORTANT: 005 and the cleanup code deploy must land together; code that writes the dropped columns errors against the post-005 schema. 006 (groups) is additive-only and must run BEFORE the groups code deploys. 007 (hybrid cadence + group_schedules + event markers) is additive-only and must run BEFORE the scheduling code deploys; the `cadence_days` drop is deferred to a future 008 once the code is deployed everywhere.
