import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getParticipantByEmail, getParticipantByToken } from '../../../../lib/participants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function todayDateString() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

// Group events awaiting the caller's response — powers the home/events
// banner. POST because tokens ride in request bodies, never URLs. The payload
// only ever contains the CALLER'S own member tokens.
export async function POST(request) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const session = await getServerSession(authOptions)

    // Session identity wins over the device token (shared computers).
    let participant = null
    if (session?.user?.email) {
        participant = await getParticipantByEmail(supabaseAdmin, session.user.email)
    }
    if (!participant && body.participantToken) {
        participant = await getParticipantByToken(supabaseAdmin, body.participantToken)
    }

    if (!participant) {
        return Response.json({ pending: [] })
    }

    const { data: memberships, error: membershipsError } = await supabaseAdmin
        .from('group_members')
        .select('id, group_id, member_token, groups(name)')
        .eq('participant_id', participant.id)
        .is('removed_at', null)

    if (membershipsError) {
        return Response.json({ error: membershipsError.message }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
        return Response.json({ pending: [] })
    }

    const groupIds = [...new Set(memberships.map((row) => row.group_id))]
    const membershipByGroup = {}
    for (const membership of memberships) {
        membershipByGroup[membership.group_id] = membership
    }

    const { data: events, error: eventsError } = await supabaseAdmin
        .from('events')
        .select('id, title, slug, group_id, response_deadline')
        .in('group_id', groupIds)
        .gte('response_deadline', todayDateString())

    if (eventsError) {
        return Response.json({ error: eventsError.message }, { status: 500 })
    }

    if (!events || events.length === 0) {
        return Response.json({ pending: [] })
    }

    const { data: ownResponses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('event_id')
        .in('event_id', events.map((event) => event.id))
        .eq('participant_id', participant.id)
        .is('deleted_at', null)

    if (responsesError) {
        return Response.json({ error: responsesError.message }, { status: 500 })
    }

    const respondedEventIds = new Set((ownResponses || []).map((row) => row.event_id))

    const pending = events
        .filter((event) => !respondedEventIds.has(event.id))
        .map((event) => {
            const membership = membershipByGroup[event.group_id]
            return {
                groupName: membership?.groups?.name || 'Your group',
                eventTitle: event.title,
                slug: event.slug,
                responseDeadline: event.response_deadline,
                memberToken: membership?.member_token || null,
            }
        })
        .sort((a, b) => (a.responseDeadline < b.responseDeadline ? -1 : 1))

    return Response.json({ pending })
}
