import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

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

    const { data: ownershipRows, error: ownershipError } = await supabaseAdmin
        .from('event_ownerships')
        .select('*')
        .eq('event_id', params.id)
        .limit(1)

    if (ownershipError) {
        return Response.json({ error: ownershipError.message }, { status: 500 })
    }

    if (!ownershipRows || ownershipRows.length === 0) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const ownership = ownershipRows[0]
    const email = normalizeEmail(session.user.email)
    const isOwner =
        ownership.owner_user_id === session.user.id ||
        (ownership.owner_email && normalizeEmail(ownership.owner_email) === email)

    if (!isOwner) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!ownership.owner_user_id && ownership.owner_email && normalizeEmail(ownership.owner_email) === email && session?.user?.id) {
        await supabaseAdmin
            .from('event_ownerships')
            .update({ owner_user_id: session.user.id })
            .eq('id', ownership.id)
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
