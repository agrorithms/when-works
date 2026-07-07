import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { normalizeEmail, getParticipantByEmail } from '../../../../lib/participants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_SCOPES = ['profile', 'all']

export async function POST(request) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body
    try {
        body = await request.json()
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { scope, confirmEmail } = body

    if (!VALID_SCOPES.includes(scope)) {
        return Response.json({ error: 'Invalid scope' }, { status: 400 })
    }

    const email = normalizeEmail(session.user.email)
    if (normalizeEmail(confirmEmail) !== email) {
        return Response.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const participant = await getParticipantByEmail(supabase, email)

    // scope === 'profile': clear preferences only. Deleting the participant
    // row would orphan response linkage for no benefit — the next sign-in
    // would recreate it anyway.
    if (scope === 'profile') {
        if (participant) {
            const { error } = await supabase
                .from('participants')
                .update({
                    display_name: null,
                    default_timezone: null,
                    date_format: null,
                    time_format: null,
                })
                .eq('id', participant.id)

            if (error) {
                return Response.json({ error: 'Delete failed' }, { status: 500 })
            }
        }

        return Response.json({ ok: true })
    }

    // scope === 'all': delete in dependency order.
    // 1. Find owned event IDs.
    let ownedEventIds = []
    if (participant) {
        const { data } = await supabase
            .from('event_ownerships')
            .select('event_id')
            .eq('participant_id', participant.id)
        ownedEventIds = [...new Set((data ?? []).map((o) => o.event_id))]
    }

    // 2. Delete responses to owned events (cascade kills their invites + answers)
    if (ownedEventIds.length > 0) {
        await supabase
            .from('responses')
            .delete()
            .in('event_id', ownedEventIds)

        // 3. Delete owned events (cascade kills ownerships, followups, invites, answers)
        await supabase
            .from('events')
            .delete()
            .in('id', ownedEventIds)
    }

    // 4. Delete responses to other events, then the participant row itself.
    if (participant) {
        await supabase
            .from('responses')
            .delete()
            .eq('participant_id', participant.id)

        await supabase.from('participants').delete().eq('id', participant.id)
    }

    return Response.json({ ok: true })
}
