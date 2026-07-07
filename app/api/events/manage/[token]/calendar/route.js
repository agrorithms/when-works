import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin'
import { resolveOwnership } from '../../../../../../lib/ownership'
import { isResponseAvailableOnDate } from '../../../../../../lib/attendance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function buildEndDateTime(selectedDate, startTime) {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const totalMinutes = startHour * 60 + startMinute + 120 // 2-hour default duration
    const endHour = Math.floor(totalMinutes / 60) % 24
    const endMinute = totalMinutes % 60
    const dayOverflow = Math.floor(totalMinutes / (24 * 60))

    let endDate = selectedDate
    if (dayOverflow > 0) {
        const d = new Date(selectedDate + 'T12:00:00')
        d.setDate(d.getDate() + dayOverflow)
        endDate = d.toISOString().split('T')[0]
    }

    return `${endDate}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`
}

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

    const startDateTime = `${selectedDate}T${startTime}:00`
    const endDateTime = buildEndDateTime(selectedDate, startTime)

    const calendarEvent = {
        summary: event.title,
        description: event.description || '',
        start: { dateTime: startDateTime, timeZone: timezone },
        end: { dateTime: endDateTime, timeZone: timezone },
        attendees: withEmail.map(r => ({ email: attendeeEmail(r) })),
    }

    const gcalRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(calendarEvent),
        }
    )

    const gcalData = await gcalRes.json()

    if (!gcalRes.ok) {
        return Response.json(
            { error: gcalData.error?.message || 'Google Calendar API error.' },
            { status: gcalRes.status }
        )
    }

    return Response.json({
        eventUrl: gcalData.htmlLink,
        addedGuests: withEmail.map(r => r.display_name),
        skippedGuests: withoutEmail.map(r => r.display_name),
    })
}
