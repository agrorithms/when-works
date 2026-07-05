import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { resolveOwnership, isResponseAvailableOnDate } from '../../../../../lib/ownership'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isBlocked(event, dateStr) {
    return (event.blocked_dates || []).includes(dateStr)
}

async function loadEventBundle(supabaseAdmin, ownership) {
    const { data: eventRows, error: eventError } = await supabaseAdmin
        .from('events')
        .select('*')
        .eq('id', ownership.event_id)
        .limit(1)

    if (eventError || !eventRows || eventRows.length === 0) {
        return { error: 'Event not found.', status: 404 }
    }

    const { data: responses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('*')
        .eq('event_id', ownership.event_id)
        .order('created_at', { ascending: true })

    if (responsesError) {
        return { error: responsesError.message, status: 500 }
    }

    const { data: followups, error: followupsError } = await supabaseAdmin
        .from('event_followups')
        .select('*')
        .eq('event_id', ownership.event_id)
        .order('created_at', { ascending: false })

    if (followupsError) {
        return { error: followupsError.message, status: 500 }
    }

    const followupIds = (followups || []).map((followup) => followup.id)
    let followupInvites = []
    let followupAnswers = []

    if (followupIds.length > 0) {
        const { data: fetchedInvites, error: invitesError } = await supabaseAdmin
            .from('event_followup_invites')
            .select('*')
            .in('followup_id', followupIds)

        if (invitesError) {
            return { error: invitesError.message, status: 500 }
        }

        followupInvites = fetchedInvites || []

        const { data: fetchedAnswers, error: answersError } = await supabaseAdmin
            .from('event_followup_answers')
            .select('*')
            .in('followup_id', followupIds)

        if (answersError) {
            return { error: answersError.message, status: 500 }
        }

        followupAnswers = fetchedAnswers || []
    }

    const event = eventRows[0]

    return {
        event: {
            ...event,
            ownership,
            publicLink: `/respond/${event.slug}`,
            manageLink: ownership.manage_token ? `/events/manage/${ownership.manage_token}` : `/events/manage/${event.id}`,
        },
        responses: responses || [],
        followups: followups || [],
        followupInvites,
        followupAnswers,
    }
}

export async function GET(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    const session = await getServerSession(authOptions)

    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const ref = params?.token

    if (!ref || typeof ref !== 'string') {
        return Response.json({ error: 'Owner link not found.' }, { status: 404 })
    }

    const { ownership, error, status } = await resolveOwnership(supabaseAdmin, ref, session, request)

    if (!ownership) {
        return Response.json({ error: error || 'Owner link not found.' }, { status: status || 404 })
    }

    const bundle = await loadEventBundle(supabaseAdmin, ownership)

    if (!bundle.event) {
        return Response.json({ error: bundle.error || 'Event not found.' }, { status: bundle.status || 500 })
    }

    return Response.json(bundle)
}

export async function POST(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    const session = await getServerSession(authOptions)

    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const ref = params?.token

    if (!ref || typeof ref !== 'string') {
        return Response.json({ error: 'Owner link not found.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const { ownership, error, status } = await resolveOwnership(supabaseAdmin, ref, session, request)

    if (!ownership) {
        return Response.json({ error: error || 'Owner link not found.' }, { status: status || 404 })
    }

    const bundle = await loadEventBundle(supabaseAdmin, ownership)
    if (!bundle.event) {
        return Response.json({ error: bundle.error || 'Event not found.' }, { status: bundle.status || 500 })
    }

    if (body.action === 'toggle_shortlist') {
        const inviteId = body.inviteId
        const nextValue = Boolean(body.isShortlisted)

        if (!inviteId) {
            return Response.json({ error: 'Missing invite id.' }, { status: 400 })
        }

        const invite = (bundle.followupInvites || []).find((row) => row.id === inviteId)
        if (!invite) {
            return Response.json({ error: 'Invite not found.' }, { status: 404 })
        }

        const followup = (bundle.followups || []).find((row) => row.id === invite.followup_id)
        if (!followup || followup.event_id !== ownership.event_id) {
            return Response.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { error: inviteError } = await supabaseAdmin
            .from('event_followup_invites')
            .update({ is_shortlisted: nextValue })
            .eq('id', invite.id)

        if (inviteError) {
            return Response.json({ error: inviteError.message }, { status: 500 })
        }

        return Response.json({ invite: { ...invite, is_shortlisted: nextValue } })
    }

    if (body.action === 'create_hosting_round') {
        const selectedDate = body.selectedDate

        if (!selectedDate) {
            return Response.json({ error: 'Pick a date first.' }, { status: 400 })
        }

        if (selectedDate < bundle.event.date_range_start || selectedDate > bundle.event.date_range_end) {
            return Response.json({ error: 'Selected date must be within the event range.' }, { status: 400 })
        }

        if (isBlocked(bundle.event, selectedDate)) {
            return Response.json({ error: 'Selected date is blocked for this event.' }, { status: 400 })
        }

        const eligibleResponses = (bundle.responses || []).filter((response) => isResponseAvailableOnDate(response, selectedDate))
        if (eligibleResponses.length === 0) {
            return Response.json({ error: 'No responders are available on that date yet.' }, { status: 400 })
        }

        const { data: round, error: roundError } = await supabaseAdmin
            .from('event_followups')
            .insert({
                event_id: ownership.event_id,
                selected_date: selectedDate,
                status: 'open',
            })
            .select('*')
            .single()

        if (roundError || !round) {
            return Response.json(
                { error: 'Could not create hosting round. ' + (roundError?.message || '') },
                { status: 500 }
            )
        }

        const inviteRows = eligibleResponses.map((response) => ({
            followup_id: round.id,
            response_id: response.id,
            invited_display_name: response.display_name,
            invited_includes_so: Boolean(response.includes_so),
        }))

        const { error: inviteError } = await supabaseAdmin
            .from('event_followup_invites')
            .insert(inviteRows)

        if (inviteError) {
            return Response.json(
                { error: 'Round created, but invite creation failed: ' + inviteError.message },
                { status: 500 }
            )
        }

        return Response.json({ round, inviteCount: inviteRows.length })
    }

    return Response.json({ error: 'Unsupported action.' }, { status: 400 })
}
