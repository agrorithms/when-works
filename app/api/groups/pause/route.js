// One-click pause target for the pre-send notice email. The pause_token is a
// narrow capability: it can only inspect pause state and pause (never resume
// or read anything else) the schedule it belongs to. POST-only — the emailed
// link lands on a confirm page first so mail scanners prefetching the GET
// can't pause anything. `action: 'inspect'` is a read: the page uses it to
// learn whether a generation is pending so it can offer the cancel choice.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { hasResolvedRound } from '../../../../lib/hostingRounds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The unresolved poll stamped for generation but not yet claimed, if any.
async function findPendingGeneration(supabaseAdmin, scheduleId) {
    const { data: events } = await supabaseAdmin
        .from('events')
        .select('id, title, auto_schedule_on')
        .eq('created_by_schedule_id', scheduleId)
        .not('auto_schedule_on', 'is', null)
        .is('auto_scheduled_at', null)

    for (const event of events || []) {
        const { resolved } = await hasResolvedRound(supabaseAdmin, event.id)
        if (!resolved) {
            return { eventId: event.id, title: event.title, scheduledFor: event.auto_schedule_on }
        }
    }
    return null
}

export async function POST(request) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) {
        return Response.json({ error: 'Pause link not found.' }, { status: 404 })
    }

    const { data: schedule, error } = await supabaseAdmin
        .from('group_schedules')
        .select('id, paused_at, auto_schedule_enabled, groups(name)')
        .eq('pause_token', token)
        .maybeSingle()

    if (error) {
        return Response.json({ error: error.message }, { status: 500 })
    }
    if (!schedule) {
        return Response.json({ error: 'Pause link not found.' }, { status: 404 })
    }

    if (body.action === 'inspect') {
        const pending = schedule.auto_schedule_enabled
            ? await findPendingGeneration(supabaseAdmin, schedule.id)
            : null
        return Response.json({
            groupName: schedule.groups?.name || null,
            paused: Boolean(schedule.paused_at),
            pendingGeneration: pending,
        })
    }

    if (!schedule.paused_at) {
        const { error: pauseError } = await supabaseAdmin
            .from('group_schedules')
            .update({ paused_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', schedule.id)

        if (pauseError) {
            return Response.json({ error: 'Could not pause automatic polls.' }, { status: 500 })
        }
    }

    // The owner's call on a pending generation: cancel it too, or let
    // tomorrow's run create the calendar event and stay paused after.
    if (body.cancelPendingGeneration) {
        await supabaseAdmin
            .from('events')
            .update({ auto_schedule_on: null })
            .eq('created_by_schedule_id', schedule.id)
            .not('auto_schedule_on', 'is', null)
            .is('auto_scheduled_at', null)
    }

    return Response.json({ paused: true, groupName: schedule.groups?.name || null })
}
