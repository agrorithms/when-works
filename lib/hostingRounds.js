// Server-only helpers for the "a date is decided" record. A CLOSED
// event_followups row with a selected_date and no invites is how a scheduled
// date enters the app without opening a hosting-coordination round:
// attendance counting, the group page's "Date: …", and the cron's
// "previous poll resolved" check all key off rounds with a selected_date.
// Written by both the manual Google-generate route and the daily cron's
// auto-scheduler.

export async function recordScheduledDate(supabaseAdmin, { eventId, selectedDate, timezone, calendarEventId = null, calendarPayload = null }) {
    const row = {
        event_id: eventId,
        selected_date: selectedDate,
        status: 'closed',
    }
    if (timezone) row.timezone = timezone
    if (calendarEventId) {
        row.calendar_sync_status = 'synced'
        row.calendar_event_id = calendarEventId
        row.calendar_payload = calendarPayload
    }

    const { data, error } = await supabaseAdmin
        .from('event_followups')
        .insert(row)
        .select('id, selected_date')
        .single()

    if (error || !data) {
        return { error: error?.message || 'Could not record the scheduled date.' }
    }
    return { round: data }
}

// Any round with a picked date = the poll is resolved (by any path: hosting
// round, manual generate, or a previous auto-schedule run).
export async function hasResolvedRound(supabaseAdmin, eventId) {
    const { data, error } = await supabaseAdmin
        .from('event_followups')
        .select('id')
        .eq('event_id', eventId)
        .not('selected_date', 'is', null)
        .limit(1)

    if (error) return { error: error.message }
    return { resolved: Boolean(data && data.length > 0) }
}
