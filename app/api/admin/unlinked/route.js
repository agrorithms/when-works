import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { isAdminRequest } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Pre-005 sanity report: identity rows the participants backfill hasn't
// linked. Checked by hand (via the panel on /admin/events) before running
// 005_cleanup_legacy_identity.sql.
export async function GET(request) {
    if (!isAdminRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const [ownershipsResult, emailResponsesResult, guestCountResult] = await Promise.all([
        supabaseAdmin
            .from('event_ownerships')
            .select('id, event_id, access_mode, owner_email, owner_user_id, events(title)')
            .is('participant_id', null),
        supabaseAdmin
            .from('responses')
            .select('id, event_id, display_name, google_email, created_at, events(title)')
            .is('participant_id', null)
            .not('google_email', 'is', null),
        supabaseAdmin
            .from('responses')
            .select('id', { count: 'exact', head: true })
            .is('participant_id', null)
            .is('google_email', null),
    ])

    if (ownershipsResult.error || emailResponsesResult.error || guestCountResult.error) {
        return Response.json(
            {
                error: ownershipsResult.error?.message
                    || emailResponsesResult.error?.message
                    || guestCountResult.error?.message
                    || 'Failed to load unlinked identities.',
            },
            { status: 500 }
        )
    }

    const unlinkedOwnerships = (ownershipsResult.data || []).map((row) => ({
        id: row.id,
        event_id: row.event_id,
        event_title: row.events?.title || null,
        access_mode: row.access_mode,
        owner_email: row.owner_email,
        owner_user_id: row.owner_user_id,
    }))

    const unlinkedEmailResponses = (emailResponsesResult.data || []).map((row) => ({
        id: row.id,
        event_id: row.event_id,
        event_title: row.events?.title || null,
        display_name: row.display_name,
        google_email: row.google_email,
        created_at: row.created_at,
    }))

    return Response.json({
        unlinkedOwnerships,
        unlinkedEmailResponses,
        unclaimedGuestCount: guestCountResult.count ?? 0,
    })
}
