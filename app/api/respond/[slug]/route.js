import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../lib/auth'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PUBLIC_EVENT_FIELDS = 'id, title, description, slug, date_range_start, date_range_end, response_deadline, blocked_dates, show_availability_counts, allow_plus_one'
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NAME_LENGTH = 80

function getAttendeeWeight(response) {
    return response.includes_so ? 2 : 1
}

// The respondent's own row, minus google_email. response_token is the
// capability that authorizes future saves — it is only ever returned here,
// to the browser that owns the session.
function sanitizeOwnResponse(row) {
    return {
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        response_type: row.response_type,
        dates: row.dates || [],
        confirmed: row.confirmed,
        includes_so: Boolean(row.includes_so),
        response_token: row.response_token,
    }
}

async function getEventBySlug(supabaseAdmin, slug) {
    const { data, error } = await supabaseAdmin
        .from('events')
        .select(PUBLIC_EVENT_FIELDS)
        .eq('slug', slug)
        .limit(1)

    if (error || !data || data.length === 0) return null
    return data[0]
}

async function getResponseCounts(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('responses')
        .select('includes_so, confirmed')
        .eq('event_id', eventId)

    const rows = data || []
    return {
        attendeeCount: rows.reduce((sum, row) => sum + getAttendeeWeight(row), 0),
        responseCount: rows.length,
        confirmedCount: rows.filter((row) => row.confirmed).length,
    }
}

async function getOpenRound(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('event_followups')
        .select('id, selected_date')
        .eq('event_id', eventId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

// Finds the respondent's own row: signed-in users by verified google_email,
// guests by their response_token capability.
async function resolveOwnResponse(supabaseAdmin, eventId, session, responseToken) {
    if (session?.user?.email) {
        const { data } = await supabaseAdmin
            .from('responses')
            .select('*')
            .eq('event_id', eventId)
            .eq('google_email', session.user.email)
            .limit(1)

        if (data && data.length > 0) return data[0]
    }

    if (typeof responseToken === 'string' && UUID_PATTERN.test(responseToken)) {
        const { data } = await supabaseAdmin
            .from('responses')
            .select('*')
            .eq('event_id', eventId)
            .eq('response_token', responseToken)
            .limit(1)

        if (data && data.length > 0) return data[0]
    }

    return null
}

async function getNextGuestNumber(supabaseAdmin, eventId) {
    const { data } = await supabaseAdmin
        .from('responses')
        .select('display_name')
        .eq('event_id', eventId)
        .like('display_name', 'Guest %')

    if (!data) return 1

    const guestNumbers = data
        .map((row) => {
            const match = row.display_name.match(/Guest #(\d+)/)
            return match ? parseInt(match[1]) : 0
        })
        .filter((n) => n > 0)

    return guestNumbers.length > 0 ? Math.max(...guestNumbers) + 1 : 1
}

function sanitizeDates(rawDates, event) {
    if (!Array.isArray(rawDates)) return null

    const blocked = event.blocked_dates || []
    const valid = rawDates.filter((date) =>
        typeof date === 'string' &&
        ISO_DATE_PATTERN.test(date) &&
        date >= event.date_range_start &&
        date <= event.date_range_end &&
        !blocked.includes(date)
    )

    return [...new Set(valid)].sort()
}

export async function GET(_request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const slug = params?.slug

    if (!slug || typeof slug !== 'string') {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const event = await getEventBySlug(supabaseAdmin, slug)
    if (!event) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const [counts, openRound] = await Promise.all([
        getResponseCounts(supabaseAdmin, event.id),
        getOpenRound(supabaseAdmin, event.id),
    ])

    let confirmedResponses = []
    if (event.show_availability_counts) {
        const { data } = await supabaseAdmin
            .from('responses')
            .select('id, response_type, dates, includes_so')
            .eq('event_id', event.id)
            .eq('confirmed', true)
        confirmedResponses = data || []
    }

    return Response.json({
        event,
        attendeeCount: counts.attendeeCount,
        responseCount: counts.responseCount,
        confirmedCount: counts.confirmedCount,
        confirmedResponses,
        openRound: openRound ? { selected_date: openRound.selected_date } : null,
    })
}

export async function POST(request, context) {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const params = await context.params
    const slug = params?.slug

    if (!slug || typeof slug !== 'string') {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const event = await getEventBySlug(supabaseAdmin, slug)
    if (!event) {
        return Response.json({ error: 'Event not found.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const session = await getServerSession(authOptions)

    if (body.action === 'start') {
        const existing = await resolveOwnResponse(supabaseAdmin, event.id, session, body.responseToken)

        if (existing) {
            if (session?.user?.email && !existing.google_email) {
                await supabaseAdmin
                    .from('responses')
                    .update({ google_email: session.user.email })
                    .eq('id', existing.id)
                existing.google_email = session.user.email
            }
            return Response.json({ response: sanitizeOwnResponse(existing), created: false })
        }

        const trimmedName = typeof body.name === 'string'
            ? body.name.trim().slice(0, MAX_NAME_LENGTH)
            : ''

        let displayName = trimmedName
        let internalName = trimmedName ? trimmedName.toLowerCase() : null

        if (!trimmedName) {
            const guestNumber = await getNextGuestNumber(supabaseAdmin, event.id)
            displayName = `Guest #${guestNumber}`
            internalName = `guest_${guestNumber}`
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
            .from('responses')
            .insert({
                name: internalName,
                display_name: displayName,
                includes_so: Boolean(body.includesSO),
                response_type: 'available',
                dates: [],
                confirmed: false,
                event_id: event.id,
                google_email: session?.user?.email ?? null,
            })
            .select('*')
            .single()

        if (insertError || !inserted) {
            return Response.json({ error: 'Could not start a response session.' }, { status: 500 })
        }

        return Response.json({ response: sanitizeOwnResponse(inserted), created: true })
    }

    if (body.action === 'save') {
        const existing = await resolveOwnResponse(supabaseAdmin, event.id, session, body.responseToken)

        if (!existing) {
            return Response.json({ error: 'Response session not found.' }, { status: 404 })
        }

        const updates = {}

        if ('response_type' in body) {
            if (!['available', 'unavailable'].includes(body.response_type)) {
                return Response.json({ error: 'Invalid response type.' }, { status: 400 })
            }
            updates.response_type = body.response_type
        }

        if ('dates' in body) {
            const dates = sanitizeDates(body.dates, event)
            if (dates === null) {
                return Response.json({ error: 'Invalid dates.' }, { status: 400 })
            }
            updates.dates = dates
        }

        if ('confirmed' in body) {
            updates.confirmed = Boolean(body.confirmed)
        }

        if ('includes_so' in body) {
            updates.includes_so = Boolean(body.includes_so)
        }

        if ('name' in body) {
            const trimmedName = typeof body.name === 'string'
                ? body.name.trim().slice(0, MAX_NAME_LENGTH)
                : ''
            if (trimmedName) {
                updates.display_name = trimmedName
                updates.name = trimmedName.toLowerCase()
            }
        }

        if (session?.user?.email && !existing.google_email) {
            updates.google_email = session.user.email
        }

        if (Object.keys(updates).length === 0) {
            return Response.json({ response: sanitizeOwnResponse(existing) })
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('responses')
            .update(updates)
            .eq('id', existing.id)
            .select('*')
            .single()

        if (updateError || !updated) {
            return Response.json({ error: 'Could not save your response.' }, { status: 500 })
        }

        return Response.json({ response: sanitizeOwnResponse(updated) })
    }

    if (body.action === 'hosting_info') {
        const existing = await resolveOwnResponse(supabaseAdmin, event.id, session, body.responseToken)

        if (!existing) {
            return Response.json({ error: 'Response session not found.' }, { status: 404 })
        }

        const round = await getOpenRound(supabaseAdmin, event.id)
        if (!round) {
            return Response.json({ round: null })
        }

        const { data: inviteRows } = await supabaseAdmin
            .from('event_followup_invites')
            .select('invite_token')
            .eq('followup_id', round.id)
            .eq('response_id', existing.id)
            .limit(1)

        if (!inviteRows || inviteRows.length === 0) {
            return Response.json({ round: null })
        }

        return Response.json({
            round: { selected_date: round.selected_date },
            inviteToken: inviteRows[0].invite_token,
        })
    }

    return Response.json({ error: 'Unsupported action.' }, { status: 400 })
}
