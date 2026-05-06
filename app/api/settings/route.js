import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../lib/auth'
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DATE_FORMATS = ['us', 'eu', 'iso']
const TIME_FORMATS = ['auto', '12h', '24h']

function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

function isValidTimezone(tz) {
    try {
        Intl.DateTimeFormat('en', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = normalizeEmail(session.user.email)
    const supabaseAdmin = getSupabaseAdmin()

    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('display_name, default_timezone, date_format, time_format, email')
        .eq('email', email)
        .single()

    if (error) {
        return Response.json({ error: 'Profile not found' }, { status: 404 })
    }

    return Response.json({
        name: data.display_name ?? session.user.name,
        display_name: data.display_name,
        email: data.email,
        default_timezone: data.default_timezone,
        date_format: data.date_format,
        time_format: data.time_format,
    })
}

export async function PATCH(request) {
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

    const updates = {}

    if ('display_name' in body) {
        const raw = typeof body.display_name === 'string' ? body.display_name.trim() : ''
        if (raw.length > 80) {
            return Response.json({ error: 'display_name too long (max 80 chars)' }, { status: 400 })
        }
        updates.display_name = raw.length > 0 ? raw : null
    }

    if ('default_timezone' in body) {
        if (!body.default_timezone || !isValidTimezone(body.default_timezone)) {
            return Response.json({ error: 'Invalid timezone' }, { status: 400 })
        }
        updates.default_timezone = body.default_timezone
    }

    if ('date_format' in body) {
        if (!DATE_FORMATS.includes(body.date_format)) {
            return Response.json({ error: 'Invalid date_format' }, { status: 400 })
        }
        updates.date_format = body.date_format
    }

    if ('time_format' in body) {
        if (!TIME_FORMATS.includes(body.time_format)) {
            return Response.json({ error: 'Invalid time_format' }, { status: 400 })
        }
        updates.time_format = body.time_format
    }

    if (Object.keys(updates).length === 0) {
        return Response.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const email = normalizeEmail(session.user.email)
    const supabaseAdmin = getSupabaseAdmin()

    const { error } = await supabaseAdmin
        .from('user_profiles')
        .update(updates)
        .eq('email', email)

    if (error) {
        return Response.json({ error: 'Update failed' }, { status: 500 })
    }

    return Response.json({ ok: true })
}
