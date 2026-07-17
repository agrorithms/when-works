// Server-only Google Calendar plumbing, shared by the manual generate route
// and the daily cron's auto-scheduler. Failures are classified: `permanent`
// means retrying with the same credentials cannot succeed (revoked grant,
// rejected request) — the caller should stop and tell the owner — while
// transient failures (network, 429, 5xx) are safe to retry on a later run.

const EVENT_DURATION_MINUTES = 120

// "18:00" on a date → { startDateTime, endDateTime } local-time strings for
// the Calendar API (timezone is passed separately). Handles midnight overflow.
export function buildEventTimes(selectedDate, startTime) {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const totalMinutes = startHour * 60 + startMinute + EVENT_DURATION_MINUTES
    const endHour = Math.floor(totalMinutes / 60) % 24
    const endMinute = totalMinutes % 60
    const dayOverflow = Math.floor(totalMinutes / (24 * 60))

    let endDate = selectedDate
    if (dayOverflow > 0) {
        const d = new Date(selectedDate + 'T12:00:00')
        d.setDate(d.getDate() + dayOverflow)
        endDate = d.toISOString().split('T')[0]
    }

    return {
        startDateTime: `${selectedDate}T${startTime}:00`,
        endDateTime: `${endDate}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
    }
}

// Exchanges a stored refresh token for a short-lived access token.
// invalid_grant = the owner revoked access or the token expired (7 days in
// Testing mode) — permanent until they sign in again.
export async function exchangeRefreshToken(refreshToken) {
    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            const permanent = res.status < 500 && data?.error !== 'internal_failure'
            return { error: data?.error_description || data?.error || `Token exchange failed (${res.status})`, permanent }
        }
        return { accessToken: data.access_token }
    } catch (error) {
        return { error: error?.message || 'Token exchange failed', permanent: false }
    }
}

// Creates the event on the token owner's primary calendar; Google emails the
// attendees their invites (sendUpdates=all).
export async function insertCalendarEvent({ accessToken, summary, description, selectedDate, startTime, timezone, attendeeEmails }) {
    const { startDateTime, endDateTime } = buildEventTimes(selectedDate, startTime)

    try {
        const res = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    summary,
                    description: description || '',
                    start: { dateTime: startDateTime, timeZone: timezone },
                    end: { dateTime: endDateTime, timeZone: timezone },
                    attendees: (attendeeEmails || []).map((email) => ({ email })),
                }),
            }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            return {
                error: data.error?.message || `Google Calendar API error (${res.status})`,
                status: res.status,
                permanent: res.status < 500 && res.status !== 429,
            }
        }
        return { eventId: data.id, htmlLink: data.htmlLink }
    } catch (error) {
        return { error: error?.message || 'Google Calendar request failed', permanent: false }
    }
}
