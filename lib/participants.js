// Server-only helpers for the participants table — the single identity
// surface behind responses and event ownerships. Signed-in users resolve by
// normalized email; guests by the participant_token capability stored in
// their browser's global localStorage key.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeEmail(email) {
    return email ? email.trim().toLowerCase() : null
}

export async function getParticipantByEmail(supabaseAdmin, email) {
    const normalized = normalizeEmail(email)
    if (!normalized) return null

    const { data } = await supabaseAdmin
        .from('participants')
        .select('*')
        .eq('email', normalized)
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

// The signIn callback upserts a participant on every Google sign-in, but that
// write is fire-and-forget — every participant-keyed route must tolerate a
// missing row. This is the tolerant version: fetch, create if absent.
export async function ensureParticipantForSession(supabaseAdmin, session) {
    const normalized = normalizeEmail(session?.user?.email)
    if (!normalized) return null

    const payload = { email: normalized }
    // With JWT strategy and no adapter, session.user.id carries the Google
    // sub. Informational only — never a lookup key.
    if (session?.user?.id) payload.google_user_id = session.user.id

    const { data, error } = await supabaseAdmin
        .from('participants')
        .upsert(payload, { onConflict: 'email', ignoreDuplicates: false })
        .select('*')
        .single()

    if (error || !data) return null
    return data
}

export async function getParticipantByToken(supabaseAdmin, token) {
    if (typeof token !== 'string' || !UUID_PATTERN.test(token)) return null

    const { data } = await supabaseAdmin
        .from('participants')
        .select('*')
        .eq('participant_token', token)
        .limit(1)

    return data && data.length > 0 ? data[0] : null
}

export async function createGuestParticipant(supabaseAdmin) {
    const { data, error } = await supabaseAdmin
        .from('participants')
        .insert({})
        .select('*')
        .single()

    if (error || !data) return null
    return data
}

// Repoints a response at a participant. The partial unique index
// responses_event_participant_active_idx rejects the write if the
// participant already has an active response on the event — callers should
// have ruled that out, but if the race loses, the response is returned
// unclaimed rather than erroring the request.
export async function claimResponseForParticipant(supabaseAdmin, response, participantId) {
    const { data, error } = await supabaseAdmin
        .from('responses')
        .update({ participant_id: participantId })
        .eq('id', response.id)
        .select('*')
        .single()

    if (error || !data) return response
    return data
}
