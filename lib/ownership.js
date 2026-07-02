import { isAdminRequest } from './adminAuth'

export function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

export function isResponseAvailableOnDate(response, dateStr) {
    const dates = response.dates || []
    if (response.response_type === 'available') return dates.includes(dateStr)
    return !dates.includes(dateStr)
}

// Postgres accepts UUIDs with or without hyphens; manage tokens (32 hex chars)
// also parse as UUIDs, so they safely no-match on event_id lookups.
function canBeUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
}

// Resolves an event_ownerships row from `ref`, which is either an event id
// (Google-session or admin access) or a manage_token (private owner link).
// Access paths, in order:
//   1. Admin: valid x-admin-password header resolves any event by id.
//   2. Google session: ref is an event id; the session must match
//      owner_user_id or owner_email (claiming owner_user_id when a legacy
//      email-owned row is matched).
//   3. Owner link: ref is a manage_token.
export async function resolveOwnership(supabaseAdmin, ref, session, request = null) {
    if (request && canBeUuid(ref) && isAdminRequest(request)) {
        const { data: adminRows, error: adminError } = await supabaseAdmin
            .from('event_ownerships')
            .select('*')
            .eq('event_id', ref)
            .limit(1)

        if (adminError) {
            return { error: adminError.message, status: 500 }
        }

        if (adminRows && adminRows.length > 0) {
            return { ownership: adminRows[0] }
        }
        // Fall through: ref may still be a manage_token.
    }

    const email = normalizeEmail(session?.user?.email)

    if (session?.user?.email && canBeUuid(ref)) {
        const { data: ownershipRows, error: ownershipError } = await supabaseAdmin
            .from('event_ownerships')
            .select('*')
            .eq('event_id', ref)
            .limit(1)

        if (ownershipError) {
            return { error: ownershipError.message, status: 500 }
        }

        if (ownershipRows && ownershipRows.length > 0) {
            const ownership = ownershipRows[0]
            const isOwner =
                ownership.owner_user_id === session.user.id ||
                (ownership.owner_email && normalizeEmail(ownership.owner_email) === email)

            if (!isOwner) {
                return { error: 'Forbidden', status: 403 }
            }

            if (!ownership.owner_user_id && ownership.owner_email && normalizeEmail(ownership.owner_email) === email && session?.user?.id) {
                await supabaseAdmin
                    .from('event_ownerships')
                    .update({ owner_user_id: session.user.id })
                    .eq('id', ownership.id)
                ownership.owner_user_id = session.user.id
            }

            return { ownership }
        }
    }

    const { data: tokenRows, error: tokenError } = await supabaseAdmin
        .from('event_ownerships')
        .select('*')
        .eq('manage_token', ref)
        .limit(1)

    if (tokenError) {
        return { error: tokenError.message, status: 500 }
    }

    if (!tokenRows || tokenRows.length === 0) {
        return { error: 'Owner link not found.', status: 404 }
    }

    return { ownership: tokenRows[0] }
}
