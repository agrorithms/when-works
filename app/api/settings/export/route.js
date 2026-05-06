import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = normalizeEmail(session.user.email)
    const supabase = getSupabaseAdmin()

    // Profile
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', email)
        .single()

    // Owned event IDs (via owner_email)
    const { data: ownerships } = await supabase
        .from('event_ownerships')
        .select('event_id')
        .eq('owner_email', email)

    const ownedEventIds = (ownerships ?? []).map(o => o.event_id)

    // Owned events with child data
    let events_owned = []
    if (ownedEventIds.length > 0) {
        const { data: eventsData } = await supabase
            .from('events')
            .select('*')
            .in('id', ownedEventIds)

        for (const event of (eventsData ?? [])) {
            const { data: responses } = await supabase
                .from('responses')
                .select('*')
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

            events_owned.push({ ...event, responses: responses ?? [], followups: followupsWithData })
        }
    }

    // Responses to other people's events (by google_email, excluding owned events)
    const responsesQuery = supabase
        .from('responses')
        .select('*')
        .eq('google_email', email)

    if (ownedEventIds.length > 0) {
        responsesQuery.not('event_id', 'in', `(${ownedEventIds.join(',')})`)
    }

    const { data: responses_to_others } = await responsesQuery

    // Follow-up answers tied to responses_to_others
    const otherResponseIds = (responses_to_others ?? []).map(r => r.id)
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
        responses_to_others: responses_to_others ?? [],
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
