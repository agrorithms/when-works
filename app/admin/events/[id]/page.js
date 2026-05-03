'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function EventDetailPage({
    eventRef: eventRefProp,
    backHref = '/admin/events',
    backLabel = '← Back to Events',
    onLoaded,
} = {}) {
    const params = useParams()
    const eventRef = eventRefProp || params.id

    const [event, setEvent] = useState(null)
    const [responses, setResponses] = useState([])
    const [followups, setFollowups] = useState([])
    const [followupInvites, setFollowupInvites] = useState([])
    const [followupAnswers, setFollowupAnswers] = useState([])
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [error, setError] = useState('')

    const [tab, setTab] = useState('overview')
    const [showUnconfirmed, setShowUnconfirmed] = useState(false)
    const [selectedHostingDate, setSelectedHostingDate] = useState('')
    const [hostingGenerationLoading, setHostingGenerationLoading] = useState(false)
    const [hostingError, setHostingError] = useState('')
    const [hostingSuccess, setHostingSuccess] = useState('')
    const [expandedRoundId, setExpandedRoundId] = useState(null)
    const [filterCanHost, setFilterCanHost] = useState(false)
    const [filterNoResponse, setFilterNoResponse] = useState(false)
    const [filterShortlisted, setFilterShortlisted] = useState(false)
    const [sortEarliestStart, setSortEarliestStart] = useState(true)
    const [hoveredSuggestedDate, setHoveredSuggestedDate] = useState('')
    const [pinnedSuggestedDate, setPinnedSuggestedDate] = useState('')

    const [calendarTarget, setCalendarTarget] = useState(null)
    const [calendarTimeInput, setCalendarTimeInput] = useState('')
    const [calendarLoading, setCalendarLoading] = useState(false)
    const [calendarResult, setCalendarResult] = useState(null)
    const [calendarError, setCalendarError] = useState('')

    const fetchData = useCallback(async () => {
        if (!eventRef) {
            setNotFound(true)
            setLoading(false)
            return
        }

        const response = await fetch(`/api/events/manage/${eventRef}`)
        const payload = await response.json()

        if (!response.ok) {
            if (response.status === 404) {
                setNotFound(true)
            } else {
                setError(payload.error || 'Failed to load event.')
            }
            setLoading(false)
            return
        }

        setEvent(payload.event)
        setResponses(payload.responses || [])
        setFollowups(payload.followups || [])
        setFollowupInvites(payload.followupInvites || [])
        setFollowupAnswers(payload.followupAnswers || [])
        setLoading(false)
        if (onLoaded) onLoaded(payload)
    }, [eventRef, onLoaded])

    useEffect(() => {
        const timeoutId = setTimeout(fetchData, 0)
        return () => clearTimeout(timeoutId)
    }, [fetchData])

    const handleRefresh = () => {
        setLoading(true)
        setError('')
        setNotFound(false)
        fetchData()
    }

    const getShareUrl = (slug) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/respond/${slug}`
        }
        return `/respond/${slug}`
    }

    const copyLink = () => {
        if (event) {
            navigator.clipboard.writeText(getShareUrl(event.slug))
        }
    }

    const getFollowupInviteUrl = (token) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/followup/${token}`
        }
        return `/followup/${token}`
    }

    const copyUnansweredFollowupLinksForRound = (roundId) => {
        const invites = getInvitesForRound(roundId)
        const unanswered = invites.filter(invite => !getAnswerForInvite(invite.id))
        if (unanswered.length === 0) return
        const lines = unanswered.map(i => `${i.invited_display_name}: ${getFollowupInviteUrl(i.invite_token)}`)
        navigator.clipboard.writeText(lines.join('\n'))
    }

    const copySingleFollowupLink = (token) => {
        navigator.clipboard.writeText(getFollowupInviteUrl(token))
    }

    const getFilteredResponses = () => {
        return showUnconfirmed ? responses : responses.filter(r => r.confirmed)
    }

    const getAttendeeWeight = (response) => response.includes_so ? 2 : 1

    const isResponseAvailableOnDate = (response, dateStr) => {
        const dates = response.dates || []
        if (response.response_type === 'available') return dates.includes(dateStr)
        return !dates.includes(dateStr)
    }

    const getAvailabilityForDate = (dateStr) => {
        const filtered = getFilteredResponses()
        const available = []
        const unavailable = []
        let availableCount = 0
        let unavailableCount = 0

        filtered.forEach(r => {
            const weight = getAttendeeWeight(r)
            const label = r.includes_so ? `${r.display_name} (+SO)` : r.display_name
            if (r.response_type === 'available') {
                if (r.dates.includes(dateStr)) {
                    available.push(label)
                    availableCount += weight
                } else {
                    unavailable.push(label)
                    unavailableCount += weight
                }
            } else {
                if (r.dates.includes(dateStr)) {
                    unavailable.push(label)
                    unavailableCount += weight
                } else {
                    available.push(label)
                    availableCount += weight
                }
            }
        })

        return { available, unavailable, availableCount, unavailableCount }
    }

    const getMonthsInRange = () => {
        if (!event) return []

        const start = new Date(event.date_range_start + 'T12:00:00')
        const end = new Date(event.date_range_end + 'T12:00:00')
        const months = []

        let current = new Date(start.getFullYear(), start.getMonth(), 1)
        const last = new Date(end.getFullYear(), end.getMonth(), 1)

        while (current <= last) {
            months.push({ year: current.getFullYear(), month: current.getMonth() })
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1)
        }

        return months
    }

    const getBestDates = () => {
        if (!event) return []
        const filtered = getFilteredResponses()
        const totalAttendees = filtered.reduce((sum, r) => sum + getAttendeeWeight(r), 0)
        const results = []

        const start = new Date(event.date_range_start + 'T12:00:00')
        const end = new Date(event.date_range_end + 'T12:00:00')
        const blocked = event.blocked_dates || []

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0]
            if (blocked.includes(dateStr)) continue

            const { available, availableCount } = getAvailabilityForDate(dateStr)
            results.push({ date: dateStr, count: availableCount, available, totalAttendees })
        }

        return results.sort((a, b) => b.count - a.count)
    }

    const getBestDateDiffs = (bestDates) => {
        const groupedByCount = bestDates.reduce((acc, entry) => {
            if (!acc[entry.count]) acc[entry.count] = []
            acc[entry.count].push(entry)
            return acc
        }, {})

        const diffs = {}

        Object.values(groupedByCount).forEach(group => {
            if (group.length < 2) return

            group.forEach(entry => {
                if (entry.count <= 1) return

                const others = group.filter(other => other.date !== entry.date)
                if (others.length === 0) return

                const currentSet = new Set(entry.available)
                const plus = entry.available
                    .filter(name => others.some(other => !other.available.includes(name)))
                    .sort((a, b) => a.localeCompare(b))
                const minusSet = new Set()

                others.forEach(other => {
                    other.available.forEach(name => {
                        if (!currentSet.has(name)) minusSet.add(name)
                    })
                })

                diffs[entry.date] = {
                    plus,
                    minus: Array.from(minusSet).sort((a, b) => a.localeCompare(b))
                }
            })
        })

        return diffs
    }

    const isInEventRange = (dateStr) => {
        if (!event) return false
        return dateStr >= event.date_range_start && dateStr <= event.date_range_end
    }

    const isBlocked = (dateStr) => {
        if (!event) return false
        return (event.blocked_dates || []).includes(dateStr)
    }

    const formatDate = (year, month, day) => {
        const m = String(month + 1).padStart(2, '0')
        const d = String(day).padStart(2, '0')
        return `${year}-${m}-${d}`
    }

    const getInvitesForRound = (roundId) => {
        return followupInvites.filter(i => i.followup_id === roundId)
    }

    const getAnswerForInvite = (inviteId) => {
        return followupAnswers.find(a => a.invite_id === inviteId) || null
    }

    const formatTime = (timeString, fallbackText) => {
        if (!timeString) return fallbackText || 'No time given'
        const parts = timeString.split(':')
        const hour = Number(parts[0])
        const minute = Number(parts[1])
        if (Number.isNaN(hour) || Number.isNaN(minute)) return fallbackText || timeString
        const suffix = hour >= 12 ? 'PM' : 'AM'
        const displayHour = hour % 12 === 0 ? 12 : hour % 12
        return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
    }

    const getTimeZoneOffsetMs = (dateObj, timeZone) => {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })

            const parts = formatter.formatToParts(dateObj)
            const mapped = {}
            for (const part of parts) {
                if (part.type !== 'literal') mapped[part.type] = part.value
            }

            const asUtcMs = Date.UTC(
                Number(mapped.year),
                Number(mapped.month) - 1,
                Number(mapped.day),
                Number(mapped.hour),
                Number(mapped.minute),
                Number(mapped.second)
            )

            return asUtcMs - dateObj.getTime()
        } catch {
            return 0
        }
    }

    const getUtcTimestampForZonedDateTime = (dateStr, timeStr, timeZone) => {
        if (!dateStr || !timeStr || !timeZone) return null
        const timeParts = timeStr.split(':')
        const hour = Number(timeParts[0])
        const minute = Number(timeParts[1])
        const second = Number(timeParts[2] || 0)
        if ([hour, minute, second].some(Number.isNaN)) return null

        const [year, month, day] = dateStr.split('-').map(Number)
        if ([year, month, day].some(Number.isNaN)) return null

        let utcMs = Date.UTC(year, month - 1, day, hour, minute, second)
        const firstOffset = getTimeZoneOffsetMs(new Date(utcMs), timeZone)
        utcMs -= firstOffset
        const secondOffset = getTimeZoneOffsetMs(new Date(utcMs), timeZone)
        if (secondOffset !== firstOffset) {
            utcMs -= (secondOffset - firstOffset)
        }
        return utcMs
    }

    const getComparableHostTimeValue = (answer, round) => {
        if (!answer?.preferred_start_time || !round?.selected_date) return Number.MAX_SAFE_INTEGER
        const responderTz = answer.responder_timezone || round.timezone || 'America/New_York'
        const utcMs = getUtcTimestampForZonedDateTime(round.selected_date, answer.preferred_start_time, responderTz)
        return utcMs === null ? Number.MAX_SAFE_INTEGER : utcMs
    }

    const formatRoundTimezoneTime = (answer, round) => {
        if (!answer?.preferred_start_time || !round?.selected_date) {
            return formatTime(answer?.preferred_start_time, answer?.preferred_start_time_text)
        }
        const roundTz = round.timezone || 'America/New_York'
        const responderTz = answer.responder_timezone || roundTz
        const utcMs = getUtcTimestampForZonedDateTime(round.selected_date, answer.preferred_start_time, responderTz)
        if (utcMs === null) {
            return formatTime(answer?.preferred_start_time, answer?.preferred_start_time_text)
        }
        return new Intl.DateTimeFormat('en-US', {
            timeZone: roundTz,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(new Date(utcMs))
    }

    const getRoundRowsSorted = (roundId) => {
        const round = followups.find(f => f.id === roundId)
        const rows = getInvitesForRound(roundId).map(invite => ({
            invite,
            answer: getAnswerForInvite(invite.id)
        }))

        const filteredRows = rows.filter((row) => {
            if (filterCanHost && !row.answer?.still_available) return false
            if (filterNoResponse && row.answer) return false
            if (filterShortlisted && !row.invite.is_shortlisted) return false
            return true
        })

        return filteredRows.sort((a, b) => {
            const aRank = a.answer ? (a.answer.still_available ? 0 : 1) : 2
            const bRank = b.answer ? (b.answer.still_available ? 0 : 1) : 2
            if (aRank !== bRank) return aRank - bRank

            if (sortEarliestStart && a.answer?.still_available && b.answer?.still_available) {
                const aTime = getComparableHostTimeValue(a.answer, round)
                const bTime = getComparableHostTimeValue(b.answer, round)
                if (aTime !== bTime) return aTime - bTime
            }

            return a.invite.invited_display_name.localeCompare(b.invite.invited_display_name)
        })
    }

    const toggleShortlist = async (invite) => {
        const nextValue = !invite.is_shortlisted
        if (!eventRef) return

        const response = await fetch(`/api/events/manage/${eventRef}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'toggle_shortlist',
                inviteId: invite.id,
                isShortlisted: nextValue,
            }),
        })

        if (!response.ok) return

        setFollowupInvites(prev => prev.map(i => (
            i.id === invite.id
                ? { ...i, is_shortlisted: nextValue }
                : i
        )))
    }

    const handleCreateCalendarEvent = async (selectedDate, startTime, timezone) => {
        setCalendarLoading(true)
        setCalendarError('')
        setCalendarResult(null)

        const res = await fetch(`/api/events/manage/${eventRef}/calendar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectedDate, startTime, timezone }),
        })

        const payload = await res.json()
        setCalendarLoading(false)

        if (!res.ok) {
            setCalendarError(payload.error === 'no_access_token' ? 'sign_in_required' : (payload.error || 'Could not create calendar event.'))
            return
        }

        setCalendarResult(payload)
    }

    const handleGenerateHostingRound = async () => {
        setHostingError('')
        setHostingSuccess('')

        if (!selectedHostingDate) {
            setHostingError('Pick a date first.')
            return
        }
        if (!isInEventRange(selectedHostingDate)) {
            setHostingError('Selected date must be within the event range.')
            return
        }
        if (isBlocked(selectedHostingDate)) {
            setHostingError('Selected date is blocked for this event.')
            return
        }

        setHostingGenerationLoading(true)

        if (!eventRef) {
            setHostingGenerationLoading(false)
            setHostingError('Missing event reference.')
            return
        }

        const response = await fetch(`/api/events/manage/${eventRef}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'create_hosting_round',
                selectedDate: selectedHostingDate,
            }),
        })

        const payload = await response.json()

        if (!response.ok) {
            setHostingGenerationLoading(false)
            setHostingError(payload.error || 'Could not create hosting round.')
            return
        }

        setHostingGenerationLoading(false)
        setExpandedRoundId(payload.round?.id || null)
        setHostingSuccess(`Created hosting round and ${payload.inviteCount || 0} tokenized invite links.`)
        await fetchData()
    }

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading event...</h2>
            </div>
        )
    }

    if (notFound) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>Event Not Found</h1>
                <Link href={backHref} className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    {backLabel}
                </Link>
            </div>
        )
    }

    if (error) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>{error}</h1>
                <Link href={backHref} className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    {backLabel}
                </Link>
            </div>
        )
    }

    const filteredResponses = getFilteredResponses()
    const totalPeople = filteredResponses.reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const confirmedCount = responses.filter(r => r.confirmed).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const unconfirmedCount = responses.filter(r => !r.confirmed).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const months = getMonthsInRange()
    const bestDates = getBestDates()
    const bestDateDiffs = getBestDateDiffs(bestDates)
    const activeSuggestedDate = hoveredSuggestedDate || pinnedSuggestedDate
    const activeSuggestedDiff = activeSuggestedDate ? bestDateDiffs[activeSuggestedDate] : null

    return (
        <div className="container">
            <Link href={backHref} className="nav-link">{backLabel}</Link>

            <h1 style={{ marginTop: '1rem' }}>📅 {event.title}</h1>
            {event.description && (
                <p style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>{event.description}</p>
            )}
            <h2>{confirmedCount} confirmed attendees, {unconfirmedCount} in-progress attendees</h2>

            {/* Share link */}
            <div style={{
                background: '#1e293b', borderRadius: '10px', padding: '1rem', marginBottom: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem'
            }}>
                <div style={{ overflow: 'hidden' }}>
                    <p style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        Share this link with friends:
                    </p>
                    <p style={{ color: '#6366f1', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                        {getShareUrl(event.slug)}
                    </p>
                </div>
                <button
                    onClick={copyLink}
                    style={{
                        background: '#6366f1', color: 'white', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer',
                        fontSize: '0.85rem', whiteSpace: 'nowrap'
                    }}
                >
                    📋 Copy
                </button>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <button
                    onClick={handleRefresh}
                    style={{
                        background: '#334155', color: '#e2e8f0', border: 'none',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                >
                    🔄 Refresh
                </button>
                <button
                    onClick={() => setShowUnconfirmed(!showUnconfirmed)}
                    style={{
                        background: showUnconfirmed ? '#312e81' : '#1e293b',
                        color: showUnconfirmed ? '#c7d2fe' : '#94a3b8',
                        border: showUnconfirmed ? '2px solid #6366f1' : '2px solid #334155',
                        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                    }}
                >
                    {showUnconfirmed ? '👁️ Showing all' : '👁️ Confirmed only'}
                </button>
            </div>

            <div style={{
                background: '#111827',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '1rem',
                marginBottom: '1.25rem'
            }}>
                <h3 style={{ marginBottom: '0.35rem', color: '#f8fafc' }}>🏠 Hosting Follow-Up</h3>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
                    Pick the chosen date and generate tokenized hosting links for everyone available on that date.
                    This includes both confirmed and in-progress responders.
                </p>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                    <input
                        type="date"
                        className="input-field"
                        value={selectedHostingDate}
                        onChange={(e) => setSelectedHostingDate(e.target.value)}
                        min={event.date_range_start}
                        max={event.date_range_end}
                        style={{ marginBottom: 0, maxWidth: '220px' }}
                    />
                    <button
                        onClick={handleGenerateHostingRound}
                        disabled={hostingGenerationLoading}
                        style={{
                            background: '#059669',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0.5rem 0.9rem',
                            cursor: hostingGenerationLoading ? 'default' : 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        {hostingGenerationLoading ? 'Generating...' : 'Generate Hosting Round'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setCalendarTarget(prev => prev === 'general' ? null : 'general')
                            setCalendarResult(null)
                            setCalendarError('')
                            setCalendarTimeInput('')
                        }}
                        style={{
                            background: calendarTarget === 'general' ? '#312e81' : '#1e293b',
                            color: calendarTarget === 'general' ? '#c7d2fe' : '#cbd5e1',
                            border: calendarTarget === 'general' ? '1px solid #6366f1' : '1px solid #334155',
                            borderRadius: '8px',
                            padding: '0.5rem 0.9rem',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        📅 Create Calendar Event
                    </button>
                </div>

                {calendarTarget === 'general' && (
                    <div style={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        padding: '0.65rem 0.75rem',
                        marginBottom: '0.6rem'
                    }}>
                        {calendarResult ? (
                            <div>
                                <p style={{ color: '#6ee7b7', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                                    ✅ Created!{' '}
                                    <a href={calendarResult.eventUrl} target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>
                                        Open in Google Calendar →
                                    </a>
                                </p>
                                {calendarResult.addedGuests.length > 0 && (
                                    <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                        Added as guests: {calendarResult.addedGuests.join(', ')}
                                    </p>
                                )}
                                {calendarResult.skippedGuests.length > 0 && (
                                    <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                        Not added (no linked Google account): {calendarResult.skippedGuests.join(', ')}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <>
                                <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                                    Event time for {selectedHostingDate || 'selected date'}:
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        type="time"
                                        className="input-field"
                                        value={calendarTimeInput}
                                        onChange={e => setCalendarTimeInput(e.target.value)}
                                        style={{ marginBottom: 0, maxWidth: '150px' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedHostingDate) {
                                                setCalendarError('Pick a date first.')
                                                return
                                            }
                                            if (!calendarTimeInput) {
                                                setCalendarError('Enter a time.')
                                                return
                                            }
                                            handleCreateCalendarEvent(selectedHostingDate, calendarTimeInput, 'America/New_York')
                                        }}
                                        disabled={calendarLoading}
                                        style={{
                                            background: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '7px',
                                            padding: '0.4rem 0.8rem',
                                            cursor: calendarLoading ? 'default' : 'pointer',
                                            fontSize: '0.82rem'
                                        }}
                                    >
                                        {calendarLoading ? 'Creating...' : 'Create'}
                                    </button>
                                </div>
                                {calendarError === 'sign_in_required' && (
                                    <p style={{ color: '#fcd34d', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                                        Sign in with Google to create calendar events.
                                    </p>
                                )}
                                {calendarError && calendarError !== 'sign_in_required' && (
                                    <p style={{ color: '#fca5a5', fontSize: '0.8rem', marginTop: '0.4rem' }}>{calendarError}</p>
                                )}
                            </>
                        )}
                    </div>
                )}

                <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '0.35rem' }}>Suggested dates</p>
                <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {bestDates.slice(0, 5).map(d => (
                            <button
                                key={d.date}
                                type="button"
                                onClick={() => setSelectedHostingDate(d.date)}
                                onMouseEnter={() => setHoveredSuggestedDate(d.date)}
                                onMouseLeave={() => setHoveredSuggestedDate('')}
                                onFocus={() => setHoveredSuggestedDate(d.date)}
                                onBlur={() => setHoveredSuggestedDate('')}
                                onPointerDown={(e) => {
                                    if (e.pointerType === 'touch') {
                                        setPinnedSuggestedDate(prev => prev === d.date ? '' : d.date)
                                    }
                                }}
                                style={{
                                    background: selectedHostingDate === d.date ? '#1d4ed8' : '#1e293b',
                                    color: selectedHostingDate === d.date ? '#dbeafe' : '#cbd5e1',
                                    border: selectedHostingDate === d.date ? '1px solid #60a5fa' : '1px solid #334155',
                                    borderRadius: '999px',
                                    padding: '0.25rem 0.6rem',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem'
                                }}
                                aria-describedby={activeSuggestedDate === d.date ? 'suggested-date-diff' : undefined}
                            >
                                {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </button>
                        ))}
                    </div>
                    {activeSuggestedDate && (
                        <div
                            id="suggested-date-diff"
                            role="status"
                            style={{
                                marginTop: '0.55rem',
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                                padding: '0.55rem 0.65rem',
                                maxWidth: '460px'
                            }}
                        >
                            <p style={{ color: '#cbd5e1', fontSize: '0.75rem', marginBottom: '0.35rem' }}>
                                {new Date(activeSuggestedDate + 'T12:00:00').toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric'
                                })}
                            </p>
                            {activeSuggestedDiff && (activeSuggestedDiff.plus.length > 0 || activeSuggestedDiff.minus.length > 0) ? (
                                <div style={{ fontSize: '0.76rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                    {activeSuggestedDiff.plus.map(name => (
                                        <span key={`${activeSuggestedDate}-chip-plus-${name}`} style={{ color: '#86efac' }}>
                                            +{name}
                                        </span>
                                    ))}
                                    {activeSuggestedDiff.minus.map(name => (
                                        <span key={`${activeSuggestedDate}-chip-minus-${name}`} style={{ color: '#fca5a5' }}>
                                            -{name}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No attendee diff for this date.</p>
                            )}
                        </div>
                    )}
                </div>

                {hostingError && (
                    <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '0.45rem' }}>{hostingError}</p>
                )}
                {hostingSuccess && (
                    <p style={{ color: '#6ee7b7', fontSize: '0.85rem', marginBottom: '0.45rem' }}>{hostingSuccess}</p>
                )}

                <div style={{ marginBottom: '0.8rem' }}>
                    <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '0.35rem' }}>Hosting response filters</p>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => setFilterCanHost(prev => !prev)}
                            style={{
                                background: filterCanHost ? '#065f46' : '#1e293b',
                                color: filterCanHost ? '#a7f3d0' : '#cbd5e1',
                                border: '1px solid #334155',
                                borderRadius: '999px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.78rem',
                                cursor: 'pointer'
                            }}
                        >
                            Can Host
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterNoResponse(prev => !prev)}
                            style={{
                                background: filterNoResponse ? '#7c2d12' : '#1e293b',
                                color: filterNoResponse ? '#fed7aa' : '#cbd5e1',
                                border: '1px solid #334155',
                                borderRadius: '999px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.78rem',
                                cursor: 'pointer'
                            }}
                        >
                            No Response
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterShortlisted(prev => !prev)}
                            style={{
                                background: filterShortlisted ? '#1d4ed8' : '#1e293b',
                                color: filterShortlisted ? '#dbeafe' : '#cbd5e1',
                                border: '1px solid #334155',
                                borderRadius: '999px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.78rem',
                                cursor: 'pointer'
                            }}
                        >
                            Shortlisted
                        </button>
                        <button
                            type="button"
                            onClick={() => setSortEarliestStart(prev => !prev)}
                            style={{
                                background: sortEarliestStart ? '#312e81' : '#1e293b',
                                color: sortEarliestStart ? '#c7d2fe' : '#cbd5e1',
                                border: '1px solid #334155',
                                borderRadius: '999px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.78rem',
                                cursor: 'pointer'
                            }}
                        >
                            Earliest Start
                        </button>
                    </div>
                </div>

                {followups.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No hosting rounds yet.</p>
                ) : (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        {followups.map(round => {
                            const invites = getInvitesForRound(round.id)
                            const rawRows = invites.map(invite => ({
                                invite,
                                answer: getAnswerForInvite(invite.id)
                            }))
                            const rows = getRoundRowsSorted(round.id)
                            const respondedCount = rawRows.filter(row => row.answer).length
                            const canHostRows = rawRows.filter(row => row.answer?.still_available)

                            return (
                                <div key={round.id} style={{
                                    border: '1px solid #334155',
                                    borderRadius: '10px',
                                    padding: '0.8rem'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        gap: '0.75rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        <div>
                                            <p style={{ color: '#f8fafc', fontWeight: 600, marginBottom: '0.2rem' }}>
                                                {new Date(round.selected_date + 'T12:00:00').toLocaleDateString('en-US', {
                                                    weekday: 'long',
                                                    month: 'long',
                                                    day: 'numeric',
                                                    year: 'numeric'
                                                })}
                                            </p>
                                            <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                                                {respondedCount}/{invites.length} responded, {canHostRows.length} can host, timezone: {round.timezone}
                                            </p>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <button
                                                type="button"
                                                onClick={() => copyUnansweredFollowupLinksForRound(round.id)}
                                                style={{
                                                    background: '#334155',
                                                    color: '#e2e8f0',
                                                    border: 'none',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '7px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.78rem'
                                                }}
                                            >
                                                📋 Copy Unanswered Links
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setExpandedRoundId(prev => prev === round.id ? null : round.id)}
                                                style={{
                                                    background: expandedRoundId === round.id ? '#1d4ed8' : '#1e293b',
                                                    color: expandedRoundId === round.id ? '#dbeafe' : '#cbd5e1',
                                                    border: '1px solid #334155',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '7px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.78rem'
                                                }}
                                            >
                                                {expandedRoundId === round.id ? 'Hide Responses' : 'View Responses'}
                                            </button>
                                        </div>
                                    </div>

                                    {expandedRoundId === round.id && (
                                        <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.5rem' }}>
                                            {rows.map(({ invite, answer }) => (
                                                <div key={invite.id} style={{
                                                    background: '#0f172a',
                                                    border: '1px solid #1e293b',
                                                    borderRadius: '8px',
                                                    padding: '0.6rem'
                                                }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'flex-start',
                                                        gap: '0.5rem',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <div>
                                                            <p style={{ color: '#f8fafc', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                                                                {invite.invited_display_name}
                                                                {invite.invited_includes_so ? ' (+SO)' : ''}
                                                            </p>
                                                            <p style={{ color: '#64748b', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                                                                {getFollowupInviteUrl(invite.invite_token)}
                                                            </p>
                                                        </div>
                                                        {!answer && (
                                                            <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>No response yet</span>
                                                        )}
                                                        {answer?.still_available && (
                                                            <span style={{ color: '#34d399', fontSize: '0.8rem' }}>
                                                                Can host at {formatRoundTimezoneTime(answer, round)} ({round.timezone || 'America/New_York'})
                                                            </span>
                                                        )}
                                                        {answer && !answer.still_available && (
                                                            <span style={{ color: '#f87171', fontSize: '0.8rem' }}>Cannot host</span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => copySingleFollowupLink(invite.invite_token)}
                                                            style={{
                                                                background: '#1e293b',
                                                                color: '#cbd5e1',
                                                                border: '1px solid #334155',
                                                                padding: '0.25rem 0.55rem',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.75rem'
                                                            }}
                                                        >
                                                            Copy Link
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleShortlist(invite)}
                                                            style={{
                                                                background: invite.is_shortlisted ? '#1d4ed8' : '#1e293b',
                                                                color: invite.is_shortlisted ? '#dbeafe' : '#cbd5e1',
                                                                border: '1px solid #334155',
                                                                padding: '0.25rem 0.55rem',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.75rem'
                                                            }}
                                                        >
                                                            {invite.is_shortlisted ? 'Shortlisted' : 'Shortlist'}
                                                        </button>
                                                        {answer?.still_available && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const nextTarget = calendarTarget === invite.id ? null : invite.id
                                                                    setCalendarTarget(nextTarget)
                                                                    setCalendarResult(null)
                                                                    setCalendarError('')
                                                                    setCalendarTimeInput(
                                                                        answer.preferred_start_time
                                                                            ? answer.preferred_start_time.slice(0, 5)
                                                                            : ''
                                                                    )
                                                                }}
                                                                style={{
                                                                    background: calendarTarget === invite.id ? '#312e81' : '#1e293b',
                                                                    color: calendarTarget === invite.id ? '#c7d2fe' : '#cbd5e1',
                                                                    border: calendarTarget === invite.id ? '1px solid #6366f1' : '1px solid #334155',
                                                                    padding: '0.25rem 0.55rem',
                                                                    borderRadius: '6px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.75rem'
                                                                }}
                                                            >
                                                                📅 Create Event
                                                            </button>
                                                        )}
                                                    </div>

                                                    {calendarTarget === invite.id && (
                                                        <div style={{
                                                            marginTop: '0.6rem',
                                                            borderTop: '1px solid #1e293b',
                                                            paddingTop: '0.6rem'
                                                        }}>
                                                            {calendarResult ? (
                                                                <div>
                                                                    <p style={{ color: '#6ee7b7', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                                                                        ✅ Created!{' '}
                                                                        <a href={calendarResult.eventUrl} target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>
                                                                            Open in Google Calendar →
                                                                        </a>
                                                                    </p>
                                                                    {calendarResult.addedGuests.length > 0 && (
                                                                        <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                                                                            Added as guests: {calendarResult.addedGuests.join(', ')}
                                                                        </p>
                                                                    )}
                                                                    {calendarResult.skippedGuests.length > 0 && (
                                                                        <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '0.15rem' }}>
                                                                            Not added (no linked Google account): {calendarResult.skippedGuests.join(', ')}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    {answer.preferred_start_time ? (
                                                                        <p style={{ color: '#cbd5e1', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                                                                            Create event at{' '}
                                                                            <strong>{formatRoundTimezoneTime(answer, round)}</strong>
                                                                            {' '}({round.timezone || 'America/New_York'})
                                                                        </p>
                                                                    ) : (
                                                                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                                                                            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Time:</span>
                                                                            <input
                                                                                type="time"
                                                                                className="input-field"
                                                                                value={calendarTimeInput}
                                                                                onChange={e => setCalendarTimeInput(e.target.value)}
                                                                                style={{ marginBottom: 0, maxWidth: '140px' }}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCreateCalendarEvent(
                                                                            round.selected_date,
                                                                            answer.preferred_start_time
                                                                                ? answer.preferred_start_time.slice(0, 5)
                                                                                : calendarTimeInput,
                                                                            round.timezone || 'America/New_York'
                                                                        )}
                                                                        disabled={calendarLoading || (!answer.preferred_start_time && !calendarTimeInput)}
                                                                        style={{
                                                                            background: '#059669',
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '0.3rem 0.7rem',
                                                                            cursor: (calendarLoading || (!answer.preferred_start_time && !calendarTimeInput)) ? 'default' : 'pointer',
                                                                            fontSize: '0.78rem'
                                                                        }}
                                                                    >
                                                                        {calendarLoading ? 'Creating...' : 'Create Calendar Event'}
                                                                    </button>
                                                                    {calendarError === 'sign_in_required' && (
                                                                        <p style={{ color: '#fcd34d', fontSize: '0.78rem', marginTop: '0.35rem' }}>
                                                                            Sign in with Google to create calendar events.
                                                                        </p>
                                                                    )}
                                                                    {calendarError && calendarError !== 'sign_in_required' && (
                                                                        <p style={{ color: '#fca5a5', fontSize: '0.78rem', marginTop: '0.35rem' }}>{calendarError}</p>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {filteredResponses.length === 0 ? (
                <div className="no-responses">
                    <p>No {showUnconfirmed ? '' : 'confirmed '}responses yet. Share the link!</p>
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="tabs">
                        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
                            📊 Overview
                        </button>
                        <button className={tab === 'individual' ? 'active' : ''} onClick={() => setTab('individual')}>
                            👤 Individual
                        </button>
                        <button className={tab === 'best' ? 'active' : ''} onClick={() => setTab('best')}>
                            🏆 Best Dates
                        </button>
                    </div>

                    {/* Overview Tab — Stacked Months */}
                    {tab === 'overview' && (
                        <>
                            <div className="legend">
                                <span>
                                    <span className="legend-dot" style={{ background: '#065f46', border: '2px solid #10b981' }} />
                                    All
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#1e3a2f' }} />
                                    Some
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#1e293b' }} />
                                    None
                                </span>
                                <span>
                                    <span className="legend-dot" style={{ background: '#7f1d1d' }} />
                                    Blocked
                                </span>
                            </div>

                            {months.map(({ year, month }) => {
                                const daysInMonth = new Date(year, month + 1, 0).getDate()
                                const firstDay = new Date(year, month, 1).getDay()
                                const monthName = new Date(year, month, 1).toLocaleString('default', {
                                    month: 'long', year: 'numeric'
                                })

                                return (
                                    <div key={`${year}-${month}`} style={{ marginBottom: '2rem' }}>
                                        <h2 style={{
                                            color: '#f8fafc', fontWeight: 600, textAlign: 'center',
                                            marginBottom: '0.75rem', fontSize: '1.2rem'
                                        }}>
                                            {monthName}
                                        </h2>

                                        <div className="admin-grid">
                                            {DAYS.map(d => (
                                                <div key={d} className="day-label">{d}</div>
                                            ))}

                                            {Array.from({ length: firstDay }).map((_, i) => (
                                                <div key={`empty-${i}`} className="admin-day" style={{ background: 'transparent' }} />
                                            ))}

                                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                                const day = i + 1
                                                const dateStr = formatDate(year, month, day)
                                                const inRange = isInEventRange(dateStr)
                                                const blocked = isBlocked(dateStr)

                                                if (!inRange) {
                                                    return (
                                                        <div key={dateStr} className="admin-day" style={{ opacity: 0.15 }}>
                                                            <span className="date-num">{day}</span>
                                                        </div>
                                                    )
                                                }

                                                if (blocked) {
                                                    return (
                                                        <div key={dateStr} className="admin-day" style={{ background: '#7f1d1d' }}>
                                                            <span className="date-num">{day}</span>
                                                            <span className="count">🚫</span>
                                                        </div>
                                                    )
                                                }

                                                const { available, availableCount } = getAvailabilityForDate(dateStr)
                                                const count = availableCount

                                                let className = 'admin-day '
                                                if (count === totalPeople && totalPeople > 0) className += 'all-available'
                                                else if (count > 0) className += 'some-available'
                                                else className += 'none-available'

                                                return (
                                                    <div
                                                        key={dateStr}
                                                        className={className}
                                                        title={`Available: ${available.join(', ')}`}
                                                    >
                                                        <span className="date-num">{day}</span>
                                                        <span className="count">{count}/{totalPeople}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}

                            <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                💡 Hover over a date to see who&apos;s available
                            </p>
                        </>
                    )}

                    {/* Individual Tab */}
                    {tab === 'individual' && (
                        <div>
                            {filteredResponses.map(r => (
                                <div key={r.id} className="person-card">
                                    <h3>
                                        {r.display_name}
                                        {r.includes_so && (
                                            <span style={{
                                                fontSize: '0.72rem',
                                                fontWeight: 500,
                                                marginLeft: '0.5rem',
                                                color: '#93c5fd'
                                            }}>
                                                + SO
                                            </span>
                                        )}
                                        <span style={{
                                            fontSize: '0.75rem', fontWeight: 400, marginLeft: '0.5rem',
                                            color: r.confirmed ? '#10b981' : '#f59e0b'
                                        }}>
                                            {r.confirmed ? '✅ Confirmed' : '⏳ In progress'}
                                        </span>
                                    </h3>
                                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                        Marked {r.response_type} days:
                                    </p>
                                    <div>
                                        {r.dates && r.dates.sort().map(d => (
                                            <span key={d} className={`badge ${r.response_type}`}>
                                                {new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
                                                    month: 'short', day: 'numeric'
                                                })}
                                            </span>
                                        ))}
                                        {(!r.dates || r.dates.length === 0) && (
                                            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                                No dates selected yet
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Best Dates Tab */}
                    {tab === 'best' && (
                        <div>
                            <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                Dates ranked by number of people available:
                            </p>
                            {bestDates.filter(d => d.count > 0).slice(0, 15).map(d => (
                                <div key={d.date} className="person-card" style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <div>
                                        <strong style={{ color: '#f8fafc' }}>
                                            {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
                                                weekday: 'long', month: 'long', day: 'numeric'
                                            })}
                                        </strong>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                                            {d.available.join(', ')}
                                        </div>
                                        {bestDateDiffs[d.date] && (bestDateDiffs[d.date].plus.length > 0 || bestDateDiffs[d.date].minus.length > 0) && (
                                            <div style={{ fontSize: '0.78rem', marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                {bestDateDiffs[d.date].plus.map(name => (
                                                    <span key={`${d.date}-plus-${name}`} style={{ color: '#86efac' }}>
                                                        +{name}
                                                    </span>
                                                ))}
                                                {bestDateDiffs[d.date].minus.map(name => (
                                                    <span key={`${d.date}-minus-${name}`} style={{ color: '#fca5a5' }}>
                                                        -{name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{
                                        background: d.count === d.totalAttendees ? '#065f46' : '#1e3a2f',
                                        border: d.count === d.totalAttendees ? '2px solid #10b981' : 'none',
                                        padding: '0.4rem 0.8rem', borderRadius: '8px',
                                        fontWeight: 600, fontSize: '0.9rem',
                                        color: d.count === d.totalAttendees ? '#a7f3d0' : '#94a3b8'
                                    }}>
                                        {d.count}/{d.totalAttendees}
                                    </div>
                                </div>
                            ))}
                            {bestDates.filter(d => d.count > 0).length === 0 && (
                                <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>
                                    No availability data yet.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
