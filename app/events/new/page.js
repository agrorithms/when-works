'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AdminCalendar from '../../../components/AdminCalendar'
import { saveOwnerToken } from '../../../lib/savedOwnerTokens'
import {
    describeCadence,
    validateScheduleConfig,
    computeFirstWindow,
    formatWindowLabel,
    computeDeadline,
    maxDeadlineDays,
} from '../../../lib/schedule'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 40)
}

function getToday() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

function NewEventPageInner() {
    const { status, data: session } = useSession()
    const signedIn = status === 'authenticated'
    const searchParams = useSearchParams()
    // Arriving from a group's "Plan next hangout": the created event gets
    // linked to the group and members are emailed their personal links.
    const groupRef = searchParams.get('group') || null
    const groupName = searchParams.get('groupName') || null

    const [newTitle, setNewTitle] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newSlug, setNewSlug] = useState('')
    const [newStartDate, setNewStartDate] = useState('')
    const [newEndDate, setNewEndDate] = useState('')
    const [newResponseDeadline, setNewResponseDeadline] = useState('')
    const [newBlockedDates, setNewBlockedDates] = useState([])
    const [showAvailabilityCounts, setShowAvailabilityCounts] = useState(false)
    const [allowPlusOne, setAllowPlusOne] = useState(false)
    const [createError, setCreateError] = useState('')
    const [createLoading, setCreateLoading] = useState(false)
    const [created, setCreated] = useState(false)
    const [createdEvent, setCreatedEvent] = useState(null)
    const [emailedCount, setEmailedCount] = useState(null)

    // "Repeat automatically" (group events only). groupInfo carries the
    // group's cadence + any existing schedule from the manage bundle.
    const [groupInfo, setGroupInfo] = useState(null)
    const [repeatEnabled, setRepeatEnabled] = useState(false)
    const [repeatWeekdays, setRepeatWeekdays] = useState([])
    const [repeatSendDay, setRepeatSendDay] = useState('20')
    const [repeatLeadDays, setRepeatLeadDays] = useState('7')
    const [repeatDeadlineDays, setRepeatDeadlineDays] = useState('5')
    const [repeatEmail, setRepeatEmail] = useState('')
    const [createdSchedule, setCreatedSchedule] = useState(null)
    const [scheduleError, setScheduleError] = useState(null)

    const today = getToday()
    const accessMode = signedIn ? 'google' : 'link'

    const titlePlaceholder = useMemo(() => 'e.g. Summer BBQ, Game Night...', [])

    // Prefill from the group's "Plan next hangout" link (run once on mount).
    useEffect(() => {
        if (!groupRef) return
        const prefillTitle = searchParams.get('title')
        const prefillStart = searchParams.get('start')
        const prefillEnd = searchParams.get('end')
        if (prefillTitle) {
            setNewTitle(prefillTitle)
            setNewSlug(generateSlug(prefillTitle))
        }
        if (prefillStart && prefillStart >= today) setNewStartDate(prefillStart)
        if (prefillEnd && prefillEnd >= (prefillStart || today)) setNewEndDate(prefillEnd)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Load the group's cadence + any existing schedule (access already proven
    // by the same ref the create POST will use).
    useEffect(() => {
        if (!groupRef) return
        let cancelled = false
        fetch(`/api/groups/manage/${groupRef}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data?.group) return
                setGroupInfo({ group: data.group, schedule: data.schedule || null })
                if (data.schedule) {
                    setRepeatWeekdays(data.schedule.excluded_weekdays || [])
                    if (data.schedule.send_day_of_month) setRepeatSendDay(String(data.schedule.send_day_of_month))
                    if (data.schedule.lead_days) setRepeatLeadDays(String(data.schedule.lead_days))
                    setRepeatDeadlineDays(String(data.schedule.deadline_days))
                    setRepeatEmail(data.schedule.notify_email)
                    setRepeatEnabled(!data.schedule.paused_at)
                }
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [groupRef])

    useEffect(() => {
        if (repeatEnabled && !repeatEmail && session?.user?.email) {
            setRepeatEmail(session.user.email)
        }
    }, [repeatEnabled, repeatEmail, session])

    const repeatGroup = groupInfo?.group || null
    // Validated config + first-occurrence preview, or the validation error.
    const repeatPreview = (() => {
        if (!repeatEnabled || !repeatGroup?.cadence_unit) return null
        const result = validateScheduleConfig(repeatGroup, {
            excluded_weekdays: repeatWeekdays,
            send_day_of_month: repeatGroup.cadence_unit === 'month' ? Number(repeatSendDay) : null,
            lead_days: repeatGroup.cadence_unit === 'day' ? Number(repeatLeadDays) : null,
            deadline_days: Number(repeatDeadlineDays),
            notify_email: repeatEmail,
        })
        if (result.error) return { error: result.error }
        if (!newStartDate || !newEndDate) return { config: result.config }
        const cursor = computeFirstWindow(repeatGroup, result.config, {
            anchorEvent: { date_range_start: newStartDate, date_range_end: newEndDate },
            today,
        })
        return {
            config: result.config,
            sendOn: cursor.next_send_on,
            windowLabel: formatWindowLabel(repeatGroup, cursor.next_window_start, cursor.next_window_end),
            deadline: computeDeadline(cursor.next_send_on, result.config.deadline_days, cursor.next_window_start),
        }
    })()

    const handleTitleChange = (value) => {
        setNewTitle(value)
        setNewSlug(generateSlug(value))
    }

    const handleStartDateChange = (value) => {
        if (value && value < today) {
            setCreateError('Start date cannot be in the past.')
            return
        }

        setCreateError('')
        setNewStartDate(value)

        if (newEndDate && value > newEndDate) {
            setNewEndDate('')
            setCreateError('End date must be on or after start date.')
        }

        if (newEndDate) {
            setNewBlockedDates((prev) => prev.filter((date) => date >= value && date <= newEndDate))
        }
    }

    const handleEndDateChange = (value) => {
        if (value && value < today) {
            setCreateError('End date cannot be in the past.')
            return
        }

        if (newStartDate && value < newStartDate) {
            setCreateError('End date must be on or after start date.')
            return
        }

        setCreateError('')
        setNewEndDate(value)

        if (newStartDate) {
            setNewBlockedDates((prev) => prev.filter((date) => date >= newStartDate && date <= value))
        }

        if (newResponseDeadline && value && newResponseDeadline > value) {
            setNewResponseDeadline('')
            setCreateError('Response deadline must be on or before event end date.')
        }
    }

    const handleResponseDeadlineChange = (value) => {
        if (value && value < today) {
            setCreateError('Response deadline must be in the future.')
            return
        }

        if (newEndDate && value > newEndDate) {
            setCreateError('Response deadline must be on or before event end date.')
            return
        }

        setCreateError('')
        setNewResponseDeadline(value)
    }

    const toggleBlockedDate = (dateStr) => {
        setNewBlockedDates((prev) =>
            prev.includes(dateStr) ? prev.filter((date) => date !== dateStr) : [...prev, dateStr]
        )
    }

    const createEvent = async () => {
        if (!newTitle.trim()) return setCreateError('Please enter a title.')
        if (!newStartDate) return setCreateError('Please select a start date.')
        if (!newEndDate) return setCreateError('Please select an end date.')
        if (!newSlug.trim()) return setCreateError('Please enter a URL slug.')
        if (!newResponseDeadline) return setCreateError('Please set a response deadline.')
        if (newEndDate < newStartDate) return setCreateError('End date must be after start date.')
        if (newResponseDeadline < today) return setCreateError('Response deadline must be in the future.')
        if (newResponseDeadline > newEndDate) return setCreateError('Response deadline must be on or before event end date.')

        if (accessMode === 'google' && !signedIn) {
            setCreateError('Please sign in with Google first.')
            return
        }

        if (repeatEnabled && repeatPreview?.error) {
            setCreateError(repeatPreview.error)
            return
        }

        setCreateLoading(true)
        setCreateError('')

        try {
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTitle.trim(),
                    description: newDescription.trim() || null,
                    slug: newSlug.trim(),
                    date_range_start: newStartDate,
                    date_range_end: newEndDate,
                    response_deadline: newResponseDeadline,
                    blocked_dates: newBlockedDates,
                    show_availability_counts: showAvailabilityCounts,
                    allow_plus_one: allowPlusOne,
                    access_mode: accessMode,
                    // Links link-mode events to the guest's device-wide
                    // participant (same key the respond page maintains).
                    participantToken: typeof window !== 'undefined'
                        ? localStorage.getItem('when_works_participant_token') || null
                        : null,
                    ...(groupRef ? { groupRef } : {}),
                    ...(groupRef && repeatEnabled && repeatPreview?.config
                        ? { schedule: repeatPreview.config }
                        : {}),
                }),
            })

            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                setCreateError(payload.error || 'Something went wrong.')
                return
            }

            setCreatedEvent(payload.event)
            setEmailedCount(payload.emailedCount ?? null)
            setCreatedSchedule(payload.schedule ?? null)
            setScheduleError(payload.scheduleError ?? null)
            setCreated(true)
        } catch {
            setCreateError('Something went wrong. Please try again.')
        } finally {
            setCreateLoading(false)
        }
    }

    useEffect(() => {
        if (created && createdEvent?.manageLink) {
            const token = createdEvent.manageLink.split('/').pop()
            if (token) saveOwnerToken(token)
        }
    }, [created, createdEvent])

    if (created && createdEvent) {
        return (
            <div className="container success-message" style={{ paddingTop: '2rem' }}>
                <h1>🎉</h1>
                <h1 style={{ color: '#10b981' }}>Event Created!</h1>
                <h2>&quot;{newTitle}&quot; is ready to share</h2>

                {groupRef && emailedCount !== null && (
                    <p style={{ color: '#a7f3d0', marginTop: '0.5rem' }}>
                        📧 Emailed {emailedCount} group member{emailedCount !== 1 ? 's' : ''} their personal links
                    </p>
                )}

                {createdSchedule && (
                    <p style={{ color: '#c7d2fe', marginTop: '0.5rem' }}>
                        🔁 Automatic polls are on — the next one goes out{' '}
                        {new Date(createdSchedule.next_send_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
                    </p>
                )}

                {scheduleError && (
                    <p style={{ color: '#fbbf24', marginTop: '0.5rem' }}>
                        ⚠️ {scheduleError} You can set it up from the group page.
                    </p>
                )}

                <div style={{ background: '#1e293b', borderRadius: '12px', padding: '1rem', margin: '1.5rem auto', maxWidth: '560px' }}>
                    <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Public invite link</p>
                    <p style={{ color: '#c7d2fe', wordBreak: 'break-all' }}>{createdEvent.publicLink}</p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
                        <button className="button-primary" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${createdEvent.publicLink}`)}>
                            Copy public link
                        </button>
                        <Link href="/events" className="button-secondary">
                            Open dashboard
                        </Link>
                    </div>
                </div>

                {createdEvent.manageLink && (
                    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '1rem', margin: '0 auto', maxWidth: '560px' }}>
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Private owner link</p>
                        <p style={{ color: '#f8fafc', wordBreak: 'break-all' }}>{createdEvent.manageLink}</p>
                        <button
                            className="button-secondary"
                            style={{ marginTop: '0.85rem' }}
                            onClick={() => navigator.clipboard.writeText(`${window.location.origin}${createdEvent.manageLink}`)}
                        >
                            Copy owner link
                        </button>
                    </div>
                )}

                <div style={{ marginTop: '1.25rem' }}>
                    <Link href="/events/new" className="nav-link">
                        Create another event
                    </Link>
                </div>
            </div>
        )
    }

    const startMin = today
    const endMin = newStartDate || today
    const deadlineMin = today
    const deadlineMax = newEndDate || undefined

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a' }}>
            <div className="container">
                <Link href="/events" className="nav-link">
                    ← Back to dashboard
                </Link>

                <div className="section-card" style={{ marginTop: '1rem' }}>
                    <h1>Create an event</h1>
                    <h2>Set up the event details and dates.</h2>

                    {groupRef && (
                        <div style={{ background: '#312e81', border: '2px solid #6366f1', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                            <p style={{ color: '#c7d2fe' }}>
                                👥 This event will be linked to <strong>{groupName || 'your group'}</strong> — members will be emailed their personal response links when you create it.
                            </p>
                        </div>
                    )}

                    {signedIn ? (
                        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                            <p style={{ color: '#cbd5e1', marginBottom: '0.35rem' }}>
                                Signed in with Google as <strong>{session?.user?.email || 'your account'}</strong>.
                            </p>
                            <p style={{ color: '#94a3b8' }}>
                                This event will be owned by that account automatically.
                            </p>
                        </div>
                    ) : (
                        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                            <p style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>
                                A private owner link will be generated and saved to this browser so you can manage the event.
                            </p>
                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.1rem' }}>
                                Tip: sign in with Google (top-right) to keep all your events together across devices.
                            </p>
                        </div>
                    )}

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Event Title *
                    </label>
                    <input type="text" className="input-field" placeholder={titlePlaceholder} value={newTitle} onChange={(e) => handleTitleChange(e.target.value)} />

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Description (optional)
                    </label>
                    <input type="text" className="input-field" placeholder="A short note for your invitees" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        URL Slug *
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <span style={{ color: '#64748b', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>/respond/</span>
                        <input type="text" className="input-field" placeholder="event-name" value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'))} style={{ marginBottom: 0 }} />
                    </div>

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Event Date Range *
                    </label>
                    <div className="date-range-grid">
                        <div className="date-field-col">
                            <input type="date" className="input-field" value={newStartDate} onChange={(e) => handleStartDateChange(e.target.value)} min={startMin} style={{ marginBottom: 0 }} />
                        </div>
                        <div className="date-field-col">
                            <input type="date" className="input-field" value={newEndDate} onChange={(e) => handleEndDateChange(e.target.value)} min={endMin} style={{ marginBottom: 0 }} />
                        </div>
                    </div>

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Response Deadline *
                    </label>
                    <input
                        type="date"
                        className="input-field"
                        value={newResponseDeadline}
                        onChange={(e) => handleResponseDeadlineChange(e.target.value)}
                        min={deadlineMin}
                        max={deadlineMax}
                    />

                    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1rem', marginBottom: '0.6rem', color: '#e2e8f0' }}>
                        <input type="checkbox" checked={showAvailabilityCounts} onChange={(e) => setShowAvailabilityCounts(e.target.checked)} />
                        Show availability counts to invitees
                    </label>

                    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', color: '#e2e8f0' }}>
                        <input type="checkbox" checked={allowPlusOne} onChange={(e) => setAllowPlusOne(e.target.checked)} />
                        Allow attendees to include a +1 in their response
                    </label>

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Blocked Dates
                    </label>
                    <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        Tap dates to exclude them from the event range.
                    </p>
                    <AdminCalendar
                        startDate={newStartDate}
                        endDate={newEndDate}
                        blockedDates={newBlockedDates}
                        onToggleBlocked={toggleBlockedDate}
                    />

                    {groupRef && (
                        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', color: '#e2e8f0' }}>
                                <input
                                    type="checkbox"
                                    checked={repeatEnabled}
                                    disabled={!repeatGroup?.cadence_unit}
                                    onChange={(e) => setRepeatEnabled(e.target.checked)}
                                />
                                🔁 Repeat automatically
                                {repeatGroup?.cadence_unit && (
                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                        ({describeCadence(repeatGroup)})
                                    </span>
                                )}
                            </label>
                            {!repeatGroup?.cadence_unit && (
                                <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '0.4rem' }}>
                                    {groupInfo
                                        ? 'Set a cadence on the group page to enable automatic polls.'
                                        : 'Loading group settings...'}
                                </p>
                            )}

                            {repeatEnabled && repeatGroup?.cadence_unit && (
                                <div style={{ marginTop: '0.9rem' }}>
                                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                                        After this event, the app creates each next poll on the group&apos;s cadence,
                                        emails members their personal links, and emails you when everyone has
                                        responded or the deadline passes.
                                    </p>

                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                                        Days to leave out of every poll
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                        {WEEKDAY_LABELS.map((label, day) => {
                                            const excluded = repeatWeekdays.includes(day)
                                            return (
                                                <button
                                                    key={label}
                                                    type="button"
                                                    onClick={() => setRepeatWeekdays((prev) => (
                                                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                                                    ))}
                                                    style={{
                                                        background: excluded ? '#1e293b' : '#1e3a2f',
                                                        border: excluded ? '2px solid #475569' : '2px solid #10b981',
                                                        color: excluded ? '#94a3b8' : '#a7f3d0',
                                                        borderRadius: '999px',
                                                        padding: '0.3rem 0.7rem',
                                                        fontSize: '0.82rem',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    {excluded ? '✗' : '✓'} {label}
                                                </button>
                                            )
                                        })}
                                    </div>

                                    {repeatGroup.cadence_unit === 'month' ? (
                                        <>
                                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                                Send each poll on this day of the month before (1–27)
                                            </label>
                                            <select
                                                className="input-field"
                                                value={repeatSendDay}
                                                onChange={(e) => setRepeatSendDay(e.target.value)}
                                                style={{ maxWidth: '120px' }}
                                            >
                                                {Array.from({ length: 27 }, (_, i) => i + 1).map((day) => (
                                                    <option key={day} value={String(day)}>{day}</option>
                                                ))}
                                            </select>
                                        </>
                                    ) : (
                                        <>
                                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                                Send each poll this many days before the period it covers (2–60)
                                            </label>
                                            <input
                                                type="number"
                                                min="2"
                                                max="60"
                                                className="input-field"
                                                value={repeatLeadDays}
                                                onChange={(e) => setRepeatLeadDays(e.target.value)}
                                                style={{ maxWidth: '120px' }}
                                            />
                                        </>
                                    )}

                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                        Days members get to respond
                                        {(() => {
                                            const cap = maxDeadlineDays(repeatGroup, {
                                                sendDayOfMonth: Number(repeatSendDay),
                                                leadDays: Number(repeatLeadDays),
                                            })
                                            return cap ? ` (max ${cap})` : ''
                                        })()}
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="input-field"
                                        value={repeatDeadlineDays}
                                        onChange={(e) => setRepeatDeadlineDays(e.target.value)}
                                        style={{ maxWidth: '120px' }}
                                    />

                                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                        Email you at *
                                    </label>
                                    <input
                                        type="email"
                                        className="input-field"
                                        placeholder="you@example.com"
                                        value={repeatEmail}
                                        onChange={(e) => setRepeatEmail(e.target.value)}
                                        style={{ maxWidth: '320px' }}
                                    />

                                    {repeatPreview?.error ? (
                                        <p style={{ color: '#fbbf24', fontSize: '0.85rem' }}>{repeatPreview.error}</p>
                                    ) : repeatPreview?.sendOn ? (
                                        <p style={{ color: '#c7d2fe', fontSize: '0.85rem' }}>
                                            First automatic poll goes out{' '}
                                            <strong>{new Date(repeatPreview.sendOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</strong>
                                            {' '}for <strong>{repeatPreview.windowLabel}</strong>; members respond by{' '}
                                            <strong>{new Date(repeatPreview.deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</strong>.
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    )}

                    {createError && (
                        <p style={{ color: '#fca5a5', marginBottom: '0.75rem' }}>{createError}</p>
                    )}

                    <button className="submit-btn" onClick={createEvent} disabled={createLoading}>
                        {createLoading ? 'Creating...' : 'Create event'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// useSearchParams needs a Suspense boundary for prerendering.
export default function NewEventPage() {
    return (
        <Suspense fallback={(
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading...</h2>
            </div>
        )}>
            <NewEventPageInner />
        </Suspense>
    )
}
