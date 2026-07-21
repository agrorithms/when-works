# Decision record

Running log of intentional trade-offs and deferred work. Newest first.

## 2026-07-17 — Automatic group scheduling (migration 008)

Context: opted-in group schedules auto-create the Google Calendar event the
day after the owner-summary email, picking the most-available date and
sending invites per the configured scope.

**Decisions made:**

- **Google refresh tokens are stored server-side, unencrypted** in
  `participants.google_refresh_token` (service-role-only access, RLS
  deny-all, never in payloads). FUTURE: encrypt at rest with a server env
  key.
- **OAuth app is in Testing status** → refresh tokens expire after 7 days,
  so the "reconnect Google" failure path is the *common* path until the app
  is published. Accepted for now; the pre-generation warning email and the
  opt-in UI both surface likely-stale connections (`granted_at` > 7 days).
  Publishing the OAuth app is the real fix and should happen before this
  feature is relied on in prod.
- **Date picking is most-available-wins** (ties → earliest; candidates
  strictly after generation day; confirmed responses only). FUTURE: make the
  strategy configurable — *prefer-regulars* (weight high-attendance members
  up) and *prefer-inclusivity* (weight low-attendance members up) once
  attendance scoring matures. `pickAutoDate` in `lib/autoSchedule.js` is the
  seam.
- **Manual Google-generate now records itself** as a closed hosting round
  (it historically wrote nothing to the DB, so the app couldn't see the poll
  was resolved). Both generate paths now send Google invite emails
  (`sendUpdates=all` — the old manual route used the API default of none).
- **Pause is a choice when a generation is pending**: cancel it too, or let
  it run then pause. Expressed solely through `events.auto_schedule_on`
  (null = cancelled), so the cron never checks `paused_at` for generation.
- FUTURE: **service-account calendar as a fallback organizer** when an
  owner's Google token is dead, instead of skipping with a reconnect email.
