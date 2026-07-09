import crypto from 'crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../lib/auth'
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin'
import {
    getParticipantByEmail,
    ensureParticipantForSession,
    getParticipantByToken,
} from '../../../lib/participants'
import { sanitizeGroup } from '../../../lib/groups'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CADENCE_PRESETS = [7, 14, 30, 60, 90]

function makeManageToken() {
    return crypto.randomBytes(16).toString('hex')
}

export async function GET() {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const participant = await getParticipantByEmail(supabaseAdmin, session.user.email)
    if (!participant) {
        return Response.json({ groups: [] })
    }

    const { data: groupRows, error: groupsError } = await supabaseAdmin
        .from('groups')
        .select('*')
        .eq('owner_participant_id', participant.id)
        .order('created_at', { ascending: false })

    if (groupsError) {
        return Response.json({ error: groupsError.message }, { status: 500 })
    }

    const groups = groupRows || []
    const groupIds = groups.map((group) => group.id)

    let memberCounts = {}
    let lastEventByGroup = {}

    if (groupIds.length > 0) {
        const [membersResult, eventsResult] = await Promise.all([
            supabaseAdmin
                .from('group_members')
                .select('group_id')
                .in('group_id', groupIds)
                .is('removed_at', null),
            supabaseAdmin
                .from('events')
                .select('group_id, created_at')
                .in('group_id', groupIds)
                .order('created_at', { ascending: false }),
        ])

        const firstError = membersResult.error || eventsResult.error
        if (firstError) {
            return Response.json({ error: firstError.message }, { status: 500 })
        }

        memberCounts = (membersResult.data || []).reduce((acc, row) => {
            acc[row.group_id] = (acc[row.group_id] || 0) + 1
            return acc
        }, {})

        for (const event of eventsResult.data || []) {
            if (!lastEventByGroup[event.group_id]) {
                lastEventByGroup[event.group_id] = event.created_at
            }
        }
    }

    return Response.json({
        groups: groups.map((group) => ({
            ...sanitizeGroup(group),
            memberCount: memberCounts[group.id] || 0,
            lastEventAt: lastEventByGroup[group.id] || null,
        })),
    })
}

export async function POST(request) {
    const session = await getServerSession(authOptions)
    const supabaseAdmin = getSupabaseAdmin()

    if (!supabaseAdmin) {
        return Response.json({ error: 'Missing Supabase server configuration.' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))

    const name = (body.name || '').trim().slice(0, 80)
    const accessMode = body.access_mode
    const cadenceDays = body.cadence_days == null ? null : Number(body.cadence_days)

    if (!name || !accessMode) {
        return Response.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    if (!['google', 'link'].includes(accessMode)) {
        return Response.json({ error: 'Invalid access mode.' }, { status: 400 })
    }

    if (cadenceDays !== null && !CADENCE_PRESETS.includes(cadenceDays)) {
        return Response.json({ error: 'Invalid cadence.' }, { status: 400 })
    }

    if (accessMode === 'google' && !session?.user?.email) {
        return Response.json({ error: 'Please sign in with Google to create a group this way.' }, { status: 401 })
    }

    let participant = null
    if (accessMode === 'google') {
        participant = await ensureParticipantForSession(supabaseAdmin, session)
    } else if (body.participantToken) {
        participant = await getParticipantByToken(supabaseAdmin, body.participantToken)
    }

    const { data: group, error: groupError } = await supabaseAdmin
        .from('groups')
        .insert({
            name,
            cadence_days: cadenceDays,
            access_mode: accessMode,
            owner_participant_id: participant?.id ?? null,
            manage_token: accessMode === 'link' ? makeManageToken() : null,
        })
        .select('*')
        .single()

    if (groupError || !group) {
        return Response.json({ error: groupError?.message || 'Failed to create the group.' }, { status: 500 })
    }

    return Response.json({ group: sanitizeGroup(group) })
}
