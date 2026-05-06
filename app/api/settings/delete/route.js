import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_SCOPES = ['profile', 'all']

function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

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

    if (scope === 'profile') {
        const { error } = await supabase
            .from('user_profiles')
            .delete()
            .eq('email', email)

        if (error) {
            return Response.json({ error: 'Delete failed' }, { status: 500 })
        }
        return Response.json({ ok: true })
    }

    // scope === 'all': delete in dependency order
    // 1. Find owned event IDs
    const { data: ownerships } = await supabase
        .from('event_ownerships')
        .select('event_id')
        .eq('owner_email', email)

    const ownedEventIds = (ownerships ?? []).map(o => o.event_id)

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

    // 4. Delete responses to other events where google_email matches (cascade kills invites + answers)
    await supabase
        .from('responses')
        .delete()
        .eq('google_email', email)

    // 5. Delete user_profiles row
    await supabase
        .from('user_profiles')
        .delete()
        .eq('email', email)

    return Response.json({ ok: true })
}
