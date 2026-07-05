import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { isAdminRequest } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request) {
    if (!isAdminRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const [{ data: events, error: eventsError }, { data: responses, error: responsesError }] = await Promise.all([
        supabaseAdmin
            .from('events')
            .select('*')
            .order('created_at', { ascending: false }),
        supabaseAdmin
            .from('responses')
            .select('id, event_id, confirmed, includes_so'),
    ])

    if (eventsError || responsesError) {
        return Response.json(
            { error: eventsError?.message || responsesError?.message || 'Failed to load events.' },
            { status: 500 }
        )
    }

    const responsesByEvent = (responses || []).reduce((acc, response) => {
        if (!acc[response.event_id]) acc[response.event_id] = []
        acc[response.event_id].push(response)
        return acc
    }, {})

    return Response.json({
        events: (events || []).map((event) => ({
            ...event,
            responses: responsesByEvent[event.id] || [],
        })),
    })
}
