import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/
const MAX_TIME_TEXT_LENGTH = 20

function isValidTimezone(tz) {
    if (typeof tz !== 'string' || !tz.trim()) return false
    try {
        Intl.DateTimeFormat('en', { timeZone: tz.trim() })
        return true
    } catch {
        return false
    }
}

// The invite_token is the capability: it identifies one respondent in one
// hosting round, so no other auth is needed.
async function loadInviteBundle(supabaseAdmin, inviteToken) {
    const { data: inviteRows, error: inviteError } = await supabaseAdmin
        .from('event_followup_invites')
        .select('*')
        .eq('invite_token', inviteToken)
        .limit(1)

    if (inviteError || !inviteRows || inviteRows.length === 0) return null

    const invite = inviteRows[0]

    const { data: roundRows } = await supabaseAdmin
        .from('event_followups')
        .select('*')
        .eq('id', invite.followup_id)
        .limit(1)

    if (!roundRows || roundRows.length === 0) return null

    const round = roundRows[0]

    const { data: eventRows } = await supabaseAdmin
        .from('events')
        .select('id, title')
        .eq('id', round.event_id)
        .limit(1)

    const { data: answerRows } = await supabaseAdmin
        .from('event_followup_answers')
        .select('*')
        .eq('invite_id', invite.id)
        .limit(1)

    return {
        invite: {
            id: invite.id,
            invited_display_name: invite.invited_display_name,
            invited_includes_so: Boolean(invite.invited_includes_so),
        },
        round: {
            id: round.id,
            selected_date: round.selected_date,
            timezone: round.timezone,
            status: round.status,
        },
        event: eventRows && eventRows.length > 0 ? eventRows[0] : null,
        answer: answerRows && answerRows.length > 0 ? answerRows[0] : null,
        inviteRow: invite,
        roundRow: round,
    }
}

export async function GET(_request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const inviteToken = params?.inviteToken

    if (!inviteToken || typeof inviteToken !== 'string') {
        return Response.json({ error: 'Invite not found.' }, { status: 404 })
    }

    const bundle = await loadInviteBundle(supabaseAdmin, inviteToken)
    if (!bundle) {
        return Response.json({ error: 'Invite not found.' }, { status: 404 })
    }

    const { invite, round, event, answer } = bundle
    return Response.json({ invite, round, event, answer })
}

export async function POST(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const inviteToken = params?.inviteToken

    if (!inviteToken || typeof inviteToken !== 'string') {
        return Response.json({ error: 'Invite not found.' }, { status: 404 })
    }

    const bundle = await loadInviteBundle(supabaseAdmin, inviteToken)
    if (!bundle) {
        return Response.json({ error: 'Invite not found.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    if (typeof body.still_available !== 'boolean') {
        return Response.json({ error: 'Please answer whether you can host this date.' }, { status: 400 })
    }

    const payload = {
        followup_id: bundle.roundRow.id,
        invite_id: bundle.inviteRow.id,
        still_available: body.still_available,
        preferred_start_time: null,
        preferred_start_time_text: null,
        responder_timezone: null,
    }

    if (body.still_available) {
        if (typeof body.preferred_start_time !== 'string' || !TIME_PATTERN.test(body.preferred_start_time)) {
            return Response.json({ error: 'Please enter a valid start time.' }, { status: 400 })
        }
        if (!isValidTimezone(body.responder_timezone)) {
            return Response.json({ error: 'Please enter a valid timezone.' }, { status: 400 })
        }

        payload.preferred_start_time = body.preferred_start_time
        payload.preferred_start_time_text = typeof body.preferred_start_time_text === 'string'
            ? body.preferred_start_time_text.trim().slice(0, MAX_TIME_TEXT_LENGTH) || null
            : null
        payload.responder_timezone = body.responder_timezone.trim()
    }

    let saved = null
    let saveError = null

    if (bundle.answer) {
        const { data, error } = await supabaseAdmin
            .from('event_followup_answers')
            .update(payload)
            .eq('id', bundle.answer.id)
            .select('*')
            .single()
        saved = data
        saveError = error
    } else {
        const { data, error } = await supabaseAdmin
            .from('event_followup_answers')
            .insert(payload)
            .select('*')
            .single()
        saved = data
        saveError = error
    }

    if (saveError || !saved) {
        return Response.json({ error: 'Could not save your response.' }, { status: 500 })
    }

    return Response.json({ answer: saved })
}
