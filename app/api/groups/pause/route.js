// One-click pause target for the pre-send notice email. The pause_token is a
// narrow capability: it can only pause (never resume or read) the schedule it
// belongs to. POST-only — the emailed link lands on a confirm page first so
// mail scanners prefetching the GET can't pause anything.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
        .select('id, paused_at, groups(name)')
        .eq('pause_token', token)
        .maybeSingle()

    if (error) {
        return Response.json({ error: error.message }, { status: 500 })
    }
    if (!schedule) {
        return Response.json({ error: 'Pause link not found.' }, { status: 404 })
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

    return Response.json({ paused: true, groupName: schedule.groups?.name || null })
}
