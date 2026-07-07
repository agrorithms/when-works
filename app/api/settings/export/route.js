import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { normalizeEmail, getParticipantByEmail } from '../../../../lib/participants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Tokens are live capabilities and export files get shared — strip them from
// every exported row. Other people's emails (respondents to owned events)
// are reduced to a has_email flag.
function exportResponse(row, { ownRow = false } = {}) {
    const { response_token, participant_token, participants, ...rest } = row
    if (ownRow) {
        return rest
    }
    return { ...rest, has_email: Boolean(participants?.email) }
}

export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = normalizeEmail(session.user.email)
    const supabase = getSupabaseAdmin()
    const participant = await getParticipantByEmail(supabase, email)

    // Profile — explicit columns; participant_token stays out of exports.
    const profile = participant
        ? {
            email: participant.email,
            display_name: participant.display_name,
            default_timezone: participant.default_timezone,
            date_format: participant.date_format,
            time_format: participant.time_format,
            created_at: participant.created_at,
        }
        : null

    // Owned event IDs.
    let ownedEventIds = []
    if (participant) {
        const { data } = await supabase
            .from('event_ownerships')
            .select('event_id')
            .eq('participant_id', participant.id)
        ownedEventIds = [...new Set((data ?? []).map((o) => o.event_id))]
    }

    // Owned events with child data. Soft-deleted responses are included,
    // tagged by their deleted_at.
    let events_owned = []
    if (ownedEventIds.length > 0) {
        const { data: eventsData } = await supabase
            .from('events')
            .select('*')
            .in('id', ownedEventIds)

        for (const event of (eventsData ?? [])) {
            const { data: responses } = await supabase
                .from('responses')
                .select('*, participants(email)')
                .eq('event_id', event.id)

            const { data: followups } = await supabase
                .from('event_followups')
                .select('*')
                .eq('event_id', event.id)

            const followupsWithData = []
            for (const fu of (followups ?? [])) {
                const { data: invites } = await supabase
                    .from('event_followup_invites')
                    .select('*, event_followup_answers(*)')
                    .eq('followup_id', fu.id)

                followupsWithData.push({ ...fu, invites: invites ?? [] })
            }

            events_owned.push({
                ...event,
                responses: (responses ?? []).map((row) => exportResponse(row)),
                followups: followupsWithData,
            })
        }
    }

    // Responses to other people's events. Includes soft-deleted rows.
    let responses_to_others = []
    if (participant) {
        const { data } = await supabase
            .from('responses')
            .select('*')
            .eq('participant_id', participant.id)
        responses_to_others = (data ?? [])
            .filter((row) => !ownedEventIds.includes(row.event_id))
            .map((row) => exportResponse(row, { ownRow: true }))
    }

    // Follow-up answers tied to responses_to_others
    const otherResponseIds = responses_to_others.map(r => r.id)
    let followup_answers = []
    if (otherResponseIds.length > 0) {
        const { data: invites } = await supabase
            .from('event_followup_invites')
            .select('id, followup_id, response_id')
            .in('response_id', otherResponseIds)

        const inviteIds = (invites ?? []).map(i => i.id)
        if (inviteIds.length > 0) {
            const { data: answers } = await supabase
                .from('event_followup_answers')
                .select('*')
                .in('invite_id', inviteIds)

            followup_answers = answers ?? []
        }
    }

    const payload = {
        exported_at: new Date().toISOString(),
        email,
        profile,
        events_owned,
        responses_to_others,
        followup_answers,
    }

    const date = new Date().toISOString().slice(0, 10)
    return new Response(JSON.stringify(payload, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="when-works-data-${date}.json"`,
        },
    })
}
