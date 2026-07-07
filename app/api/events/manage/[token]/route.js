import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin'
import { resolveOwnership } from '../../../../../lib/ownership'
import { isResponseAvailableOnDate } from '../../../../../lib/attendance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Explicit column list: google_email and response_token must never ride
// along in the owner payload. participants(email) is joined only to compute
// has_email, then stripped.
const MANAGED_RESPONSE_COLUMNS = 'id, event_id, name, display_name, response_type, dates, confirmed, includes_so, created_at, deleted_at, participant_id, google_email, participants(email)'

function sanitizeManagedResponse(row) {
    return {
        id: row.id,
        event_id: row.event_id,
        name: row.name,
        display_name: row.display_name,
        response_type: row.response_type,
        dates: row.dates || [],
        confirmed: row.confirmed,
        includes_so: Boolean(row.includes_so),
        created_at: row.created_at,
        deleted_at: row.deleted_at,
        participant_id: row.participant_id,
        // google_email fallback covers rows the backfill hasn't linked yet;
        // goes away with the post-005 cleanup PR.
        has_email: Boolean(row.participants?.email || row.google_email),
    }
}

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

    const { data: responseRows, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select(MANAGED_RESPONSE_COLUMNS)
        .eq('event_id', ownership.event_id)
        .order('created_at', { ascending: true })

    if (responsesError) {
        return { error: responsesError.message, status: 500 }
    }

    const allResponses = (responseRows || []).map(sanitizeManagedResponse)
    const responses = allResponses.filter((row) => !row.deleted_at)
    const deletedResponses = allResponses.filter((row) => row.deleted_at)

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
        responses,
        deletedResponses,
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

    if (body.action === 'delete_response') {
        const responseId = body.responseId

        if (!responseId) {
            return Response.json({ error: 'Missing response id.' }, { status: 400 })
        }

        const target = (bundle.responses || []).find((row) => row.id === responseId)
        if (!target) {
            return Response.json({ error: 'Response not found.' }, { status: 404 })
        }

        const { data: deleted, error: deleteError } = await supabaseAdmin
            .from('responses')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', responseId)
            .eq('event_id', ownership.event_id)
            .select(MANAGED_RESPONSE_COLUMNS)
            .single()

        if (deleteError || !deleted) {
            return Response.json({ error: 'Could not delete the response.' }, { status: 500 })
        }

        return Response.json({ response: sanitizeManagedResponse(deleted) })
    }

    if (body.action === 'restore_response') {
        const responseId = body.responseId

        if (!responseId) {
            return Response.json({ error: 'Missing response id.' }, { status: 400 })
        }

        const target = (bundle.deletedResponses || []).find((row) => row.id === responseId)
        if (!target) {
            return Response.json({ error: 'Response not found.' }, { status: 404 })
        }

        // The person may have started a fresh response since the delete; two
        // active rows for one participant would also violate the unique index.
        if (target.participant_id) {
            const activeDuplicate = (bundle.responses || []).find(
                (row) => row.participant_id === target.participant_id
            )
            if (activeDuplicate) {
                return Response.json(
                    { error: `This person has since started a new response ("${activeDuplicate.display_name}"). Delete that one first if you want to restore this instead.` },
                    { status: 409 }
                )
            }
        }

        const { data: restored, error: restoreError } = await supabaseAdmin
            .from('responses')
            .update({ deleted_at: null })
            .eq('id', responseId)
            .eq('event_id', ownership.event_id)
            .select(MANAGED_RESPONSE_COLUMNS)
            .single()

        if (restoreError || !restored) {
            if (restoreError?.code === '23505') {
                return Response.json(
                    { error: 'This person has since started a new response. Delete that one first if you want to restore this instead.' },
                    { status: 409 }
                )
            }
            return Response.json({ error: 'Could not restore the response.' }, { status: 500 })
        }

        return Response.json({ response: sanitizeManagedResponse(restored) })
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

        // bundle.responses is active-only, so deleted responses never get
        // hosting invites.
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
