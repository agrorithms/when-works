import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin'
import { resolveOwnership } from '../../../../../../lib/ownership'
import { isResponseAvailableOnDate } from '../../../../../../lib/attendance'
import { insertCalendarEvent } from '../../../../../../lib/googleCalendar'
import { recordScheduledDate } from '../../../../../../lib/hostingRounds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request, context) {
    const session = await getServerSession(authOptions)

    if (!session?.accessToken) {
        return Response.json({ error: 'no_access_token' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const ref = params?.token

    if (!ref || typeof ref !== 'string') {
        return Response.json({ error: 'Owner link not found.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const { selectedDate, startTime, timezone } = body

    if (!selectedDate || !startTime || !timezone) {
        return Response.json({ error: 'Missing selectedDate, startTime, or timezone.' }, { status: 400 })
    }

    const { ownership, error, status } = await resolveOwnership(supabaseAdmin, ref, session, request)
    if (!ownership) {
        return Response.json({ error: error || 'Owner link not found.' }, { status: status || 404 })
    }

    const { data: eventRows, error: eventError } = await supabaseAdmin
        .from('events')
        .select('*')
        .eq('id', ownership.event_id)
        .limit(1)

    if (eventError || !eventRows?.length) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const event = eventRows[0]

    const { data: responses, error: responsesError } = await supabaseAdmin
        .from('responses')
        .select('*, participants(email)')
        .eq('event_id', ownership.event_id)
        .is('deleted_at', null)

    if (responsesError) {
        return Response.json({ error: responsesError.message }, { status: 500 })
    }

    const attendeeEmail = (r) => r.participants?.email || null

    const availableResponses = (responses || []).filter(r => isResponseAvailableOnDate(r, selectedDate))
    const withEmail = availableResponses.filter(r => attendeeEmail(r))
    const withoutEmail = availableResponses.filter(r => !attendeeEmail(r))

    const created = await insertCalendarEvent({
        accessToken: session.accessToken,
        summary: event.title,
        description: event.description || '',
        selectedDate,
        startTime,
        timezone,
        attendeeEmails: withEmail.map(attendeeEmail),
    })

    if (created.error) {
        return Response.json({ error: created.error }, { status: created.status || 502 })
    }

    // Generating a calendar event decides the date: record it as a closed
    // round so attendance counts and automation sees the poll as resolved.
    // Best-effort — the Google event exists either way.
    const recorded = await recordScheduledDate(supabaseAdmin, {
        eventId: event.id,
        selectedDate,
        timezone,
        calendarEventId: created.eventId,
        calendarPayload: { htmlLink: created.htmlLink, startTime },
    })
    if (recorded.error) {
        console.error('[calendar] could not record scheduled date:', recorded.error)
    }

    return Response.json({
        eventUrl: created.htmlLink,
        addedGuests: withEmail.map(r => r.display_name),
        skippedGuests: withoutEmail.map(r => r.display_name),
    })
}
