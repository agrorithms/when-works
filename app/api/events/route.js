import crypto from 'crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../lib/auth'
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin'
import {
    normalizeEmail,
    getParticipantByEmail,
    ensureParticipantForSession,
    getParticipantByToken,
} from '../../../lib/participants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function makeManageToken() {
    return crypto.randomBytes(16).toString('hex')
}

async function getOwnedEventsForSession(session) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        throw new Error('Missing Supabase server configuration.')
    }

    const email = normalizeEmail(session.user.email)
    const participant = await getParticipantByEmail(supabaseAdmin, email)

    const participantQuery = participant
        ? supabaseAdmin
            .from('event_ownerships')
            .select('*')
            .eq('participant_id', participant.id)
        : Promise.resolve({ data: [], error: null })

    // Legacy fallback until the post-005 cleanup PR: rows old code wrote by
    // email that the backfill hasn't linked yet.
    const emailQuery = email
        ? supabaseAdmin
            .from('event_ownerships')
            .select('*')
            .eq('owner_email', email)
        : Promise.resolve({ data: [], error: null })

    const [{ data: participantRows, error: participantError }, { data: emailRows, error: emailError }] = await Promise.all([
        participantQuery,
        emailQuery,
    ])

    if (participantError) {
        throw participantError
    }

    if (emailError) {
        throw emailError
    }

    const rows = [...(participantRows || []), ...(emailRows || [])]
        .filter((row, index, allRows) => index === allRows.findIndex((candidate) => candidate.event_id === row.event_id))

    const claimableRows = rows.filter((row) => !row.participant_id)
    if (claimableRows.length > 0) {
        const claimant = participant || await ensureParticipantForSession(supabaseAdmin, session)
        if (claimant) {
            await supabaseAdmin
                .from('event_ownerships')
                .update({ participant_id: claimant.id })
                .in('id', claimableRows.map((row) => row.id))
        }
    }

    const eventIds = [...new Set(rows.map((row) => row.event_id))]
    if (eventIds.length === 0) return []

    const { data: events, error: eventsError } = await supabaseAdmin
        .from('events')
        .select('*')
        .in('id', eventIds)
        .order('created_at', { ascending: false })

    if (eventsError) {
        throw eventsError
    }

    const { data: responses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('id, event_id, confirmed, includes_so')
        .in('event_id', eventIds)
        .is('deleted_at', null)

    if (responsesError) {
        throw responsesError
    }

    const responsesByEvent = (responses || []).reduce((acc, response) => {
        if (!acc[response.event_id]) acc[response.event_id] = []
        acc[response.event_id].push(response)
        return acc
    }, {})

    const ownershipByEvent = rows.reduce((acc, row) => {
        acc[row.event_id] = row
        return acc
    }, {})

    return (events || []).map((event) => {
        const eventResponses = responsesByEvent[event.id] || []
        const ownership = ownershipByEvent[event.id] || null

        return {
            ...event,
            ownership,
            responseCount: eventResponses.length,
            confirmedCount: eventResponses.filter((response) => response.confirmed).length,
            publicLink: `/respond/${event.slug}`,
            manageLink: ownership?.manage_token ? `/events/manage/${ownership.manage_token}` : `/events/manage/${event.id}`,
        }
    })
}

export async function GET() {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const events = await getOwnedEventsForSession(session)
        return Response.json({ events })
    } catch (error) {
        return Response.json(
            { error: error?.message || 'Failed to load events' },
            { status: 500 }
        )
    }
}

export async function POST(request) {
    const session = await getServerSession(authOptions)
    const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const body = await request.json()

    const title = (body.title || '').trim()
    const description = (body.description || '').trim() || null
    const slug = (body.slug || '').trim()
    const dateRangeStart = body.date_range_start
    const dateRangeEnd = body.date_range_end
    const responseDeadline = body.response_deadline
    const blockedDates = Array.isArray(body.blocked_dates) ? body.blocked_dates : []
    const showAvailabilityCounts = Boolean(body.show_availability_counts)
    const allowPlusOne = Boolean(body.allow_plus_one)
    const accessMode = body.access_mode
    const ownerEmail = normalizeEmail(body.owner_email)

    if (!title || !slug || !dateRangeStart || !dateRangeEnd || !responseDeadline || !accessMode) {
        return Response.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    if (!['google', 'link'].includes(accessMode)) {
        return Response.json({ error: 'Invalid access mode.' }, { status: 400 })
    }

    if (accessMode === 'google' && !session?.user?.id) {
        return Response.json({ error: 'Please sign in with Google to create an event this way.' }, { status: 401 })
    }

    let participant = null
    if (accessMode === 'google') {
        participant = await ensureParticipantForSession(supabaseAdmin, session)
    } else if (body.participantToken) {
        participant = await getParticipantByToken(supabaseAdmin, body.participantToken)
    }

    const { data: eventData, error: eventError } = await supabaseAdmin
        .from('events')
        .insert({
            title,
            description,
            slug,
            date_range_start: dateRangeStart,
            date_range_end: dateRangeEnd,
            response_deadline: responseDeadline,
            blocked_dates: blockedDates,
            show_availability_counts: showAvailabilityCounts,
            allow_plus_one: allowPlusOne,
        })
        .select()
        .single()

    if (eventError) {
        return Response.json(
            { error: eventError.code === '23505' ? 'That URL slug is already taken.' : eventError.message },
            { status: 400 }
        )
    }

    // owner_user_id / owner_email are legacy dual-writes until the post-005
    // cleanup PR; participant_id is the identity going forward.
    const ownershipPayload = {
        event_id: eventData.id,
        access_mode: accessMode,
        participant_id: participant?.id ?? null,
        owner_user_id: accessMode === 'google' ? session.user.id : null,
        owner_email: accessMode === 'google' ? normalizeEmail(session.user.email) : ownerEmail,
        manage_token: accessMode === 'link' ? makeManageToken() : null,
    }

    const { data: ownershipData, error: ownershipError } = await supabaseAdmin
        .from('event_ownerships')
        .insert(ownershipPayload)
        .select()
        .single()

    if (ownershipError) {
        await supabaseAdmin.from('events').delete().eq('id', eventData.id)
        return Response.json(
            { error: ownershipError.message || 'Failed to save event ownership.' },
            { status: 500 }
        )
    }

    return Response.json({
        event: {
            ...eventData,
            ownership: ownershipData,
            publicLink: `/respond/${eventData.slug}`,
            manageLink: ownershipData.manage_token ? `/events/manage/${ownershipData.manage_token}` : `/events/manage/${eventData.id}`,
        },
    })
}
