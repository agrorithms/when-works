import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../lib/auth'
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

export async function GET(request) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = normalizeEmail(session.user.email)
    const supabaseAdmin = getSupabaseAdmin()

    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('display_name, default_timezone, email')
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
