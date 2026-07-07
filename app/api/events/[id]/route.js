import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { resolveOwnership } from '../../../../lib/ownership'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request, context) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    if (!params?.id) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const { ownership, error: ownershipError, status } = await resolveOwnership(supabaseAdmin, params.id, session)

    if (!ownership) {
        return Response.json({ error: ownershipError || 'Event not found.' }, { status: status || 404 })
    }

    const { data: eventRows, error: eventError } = await supabaseAdmin
        .from('events')
        .select('*')
        .eq('id', params.id)
        .limit(1)

    if (eventError || !eventRows || eventRows.length === 0) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const { data: responses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('id, display_name, response_type, dates, confirmed, includes_so, created_at')
        .eq('event_id', params.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

    if (responsesError) {
        return Response.json({ error: responsesError.message }, { status: 500 })
    }

    return Response.json({
        event: {
            ...eventRows[0],
            ownership,
            publicLink: `/respond/${eventRows[0].slug}`,
            manageLink: ownership.manage_token ? `/events/manage/${ownership.manage_token}` : `/events/manage/${eventRows[0].id}`,
        },
        responses: responses || [],
    })
}
