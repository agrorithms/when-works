'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import AdminCalendar from '../../../components/AdminCalendar'

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

export default function NewEventPage() {
    const { status, data: session } = useSession()
    const signedIn = status === 'authenticated'

    const [accessMode, setAccessMode] = useState(signedIn ? 'google' : 'link')
    const [newTitle, setNewTitle] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newSlug, setNewSlug] = useState('')
    const [newStartDate, setNewStartDate] = useState('')
    const [newEndDate, setNewEndDate] = useState('')
    const [newResponseDeadline, setNewResponseDeadline] = useState('')
    const [newBlockedDates, setNewBlockedDates] = useState([])
    const [showAvailabilityCounts, setShowAvailabilityCounts] = useState(false)
    const [guestEmail, setGuestEmail] = useState('')
    const [createError, setCreateError] = useState('')
    const [createLoading, setCreateLoading] = useState(false)
    const [created, setCreated] = useState(false)
    const [createdEvent, setCreatedEvent] = useState(null)

    const today = getToday()
    const effectiveAccessMode = signedIn ? 'google' : accessMode

    const titlePlaceholder = useMemo(() => 'e.g. Summer BBQ, Game Night...', [])

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

        if (effectiveAccessMode === 'google' && !signedIn) {
            setCreateError('Please sign in with Google first.')
            return
        }

        if (effectiveAccessMode === 'email' && !guestEmail.trim()) {
            setCreateError('Please enter the email address that should claim this event later.')
            return
        }

        setCreateLoading(true)
        setCreateError('')

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
                access_mode: effectiveAccessMode,
                owner_email: !signedIn && effectiveAccessMode === 'email' ? guestEmail.trim() : null,
            }),
        })

        const payload = await response.json()

        if (!response.ok) {
            setCreateError(payload.error || 'Something went wrong.')
            setCreateLoading(false)
            return
        }

        setCreatedEvent(payload.event)
        setCreated(true)
        setCreateLoading(false)
    }

    if (created && createdEvent) {
        return (
            <div className="container success-message" style={{ paddingTop: '2rem' }}>
                <h1>🎉</h1>
                <h1 style={{ color: '#10b981' }}>Event Created!</h1>
                <h2>&quot;{newTitle}&quot; is ready to share</h2>

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
                            <p style={{ color: '#cbd5e1', marginBottom: '0.75rem' }}>
                                Want durable access across devices? Sign in with Google, or create as a guest and save a private owner link.
                            </p>
                            <button onClick={() => signIn('google', { callbackUrl: '/events/new' })} className="button-primary">
                                Continue with Google
                            </button>
                        </div>
                    )}

                    {!signedIn && (
                        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.1rem' }}>
                            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.9rem', background: '#111827', border: effectiveAccessMode === 'email' ? '2px solid #6366f1' : '1px solid #334155', borderRadius: '12px', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    checked={effectiveAccessMode === 'email'}
                                    onChange={() => setAccessMode('email')}
                                    style={{ marginTop: '0.15rem' }}
                                />
                                <div>
                                    <h3 style={{ marginBottom: '0.2rem' }}>Guest with email claim</h3>
                                    <p style={{ color: '#94a3b8' }}>
                                        You can create the event now, then later claim it by signing in with the same Google email.
                                    </p>
                                </div>
                            </label>

                            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.9rem', background: '#111827', border: effectiveAccessMode === 'link' ? '2px solid #6366f1' : '1px solid #334155', borderRadius: '12px', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    checked={effectiveAccessMode === 'link'}
                                    onChange={() => setAccessMode('link')}
                                    style={{ marginTop: '0.15rem' }}
                                />
                                <div>
                                    <h3 style={{ marginBottom: '0.2rem' }}>Guest with private owner link</h3>
                                    <p style={{ color: '#94a3b8' }}>
                                        The app will generate a private link you must keep to reopen the owner page later.
                                    </p>
                                </div>
                            </label>
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

                    {!signedIn && effectiveAccessMode === 'email' && (
                        <>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                Claim email *
                            </label>
                            <input
                                type="email"
                                className="input-field"
                                placeholder="the-email-that-will-own-this-event@example.com"
                                value={guestEmail}
                                onChange={(e) => setGuestEmail(e.target.value)}
                            />
                        </>
                    )}

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

                    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1rem', marginBottom: '1rem', color: '#e2e8f0' }}>
                        <input type="checkbox" checked={showAvailabilityCounts} onChange={(e) => setShowAvailabilityCounts(e.target.checked)} />
                        Show availability counts to invitees
                    </label>

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
