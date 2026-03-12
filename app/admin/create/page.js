'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import AdminCalendar from '../../../components/AdminCalendar'
import Link from 'next/link'

export default function CreateEventPage() {
    const router = useRouter()

    const [newTitle, setNewTitle] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newSlug, setNewSlug] = useState('')
    const [newStartDate, setNewStartDate] = useState('')
    const [newEndDate, setNewEndDate] = useState('')
    const [newBlockedDates, setNewBlockedDates] = useState([])
    const [createError, setCreateError] = useState('')
    const [createLoading, setCreateLoading] = useState(false)
    const [created, setCreated] = useState(false)
    const [createdSlug, setCreatedSlug] = useState('')

    const getToday = () => {
        const now = new Date()
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const d = String(now.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    const today = getToday()

    const generateSlug = (title) => {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 40)
    }

    const handleTitleChange = (val) => {
        setNewTitle(val)
        setNewSlug(generateSlug(val))
    }

    const handleStartDateChange = (val) => {
        setNewStartDate(val)
        if (newEndDate && val > newEndDate) {
            setNewEndDate('')
        }
        if (newEndDate) {
            setNewBlockedDates(prev => prev.filter(d => d >= val && d <= newEndDate))
        }
    }

    const handleEndDateChange = (val) => {
        setNewEndDate(val)
        if (newStartDate && val < newStartDate) {
            setNewStartDate('')
        }
        if (newStartDate) {
            setNewBlockedDates(prev => prev.filter(d => d >= newStartDate && d <= val))
        }
    }

    const toggleBlockedDate = (dateStr) => {
        setNewBlockedDates(prev =>
            prev.includes(dateStr)
                ? prev.filter(d => d !== dateStr)
                : [...prev, dateStr]
        )
    }

    const getShareUrl = (slug) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/respond/${slug}`
        }
        return `/respond/${slug}`
    }

    const copyLink = () => {
        navigator.clipboard.writeText(getShareUrl(createdSlug))
    }

    const createEvent = async () => {
        if (!newTitle.trim()) { setCreateError('Please enter a title.'); return }
        if (!newStartDate) { setCreateError('Please select a start date.'); return }
        if (!newEndDate) { setCreateError('Please select an end date.'); return }
        if (newEndDate < newStartDate) { setCreateError('End date must be after start date.'); return }
        if (!newSlug.trim()) { setCreateError('Please enter a URL slug.'); return }

        setCreateLoading(true)
        setCreateError('')

        const { error } = await supabase
            .from('events')
            .insert({
                title: newTitle.trim(),
                description: newDescription.trim() || null,
                slug: newSlug.trim(),
                date_range_start: newStartDate,
                date_range_end: newEndDate,
                blocked_dates: newBlockedDates
            })

        if (error) {
            if (error.code === '23505') {
                setCreateError('That URL slug is already taken. Try a different one.')
            } else {
                setCreateError('Something went wrong: ' + error.message)
            }
        } else {
            setCreatedSlug(newSlug.trim())
            setCreated(true)
        }

        setCreateLoading(false)
    }

    // Success screen
    if (created) {
        return (
            <div className="container success-message" style={{ paddingTop: '2rem' }}>
                <h1>🎉</h1>
                <h1 style={{ color: '#10b981' }}>Event Created!</h1>
                <h2>&quot;{newTitle}&quot; is ready to share</h2>

                <div style={{
                    background: '#1e293b', borderRadius: '10px', padding: '1rem', margin: '1.5rem auto',
                    maxWidth: '500px', textAlign: 'left'
                }}>
                    <p style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        Share this link with your friends:
                    </p>
                    <p style={{ color: '#6366f1', fontSize: '0.95rem', wordBreak: 'break-all', marginBottom: '0.75rem' }}>
                        {getShareUrl(createdSlug)}
                    </p>
                    <button
                        onClick={copyLink}
                        style={{
                            background: '#6366f1', color: 'white', border: 'none',
                            padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer',
                            fontSize: '0.85rem', width: '100%'
                        }}
                    >
                        📋 Copy Link
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                    <Link href="/admin/events" className="nav-link">View All Events →</Link>
                    <span style={{ color: '#334155' }}>|</span>
                    <span
                        className="nav-link"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                            setCreated(false)
                            setNewTitle('')
                            setNewDescription('')
                            setNewSlug('')
                            setNewStartDate('')
                            setNewEndDate('')
                            setNewBlockedDates([])
                        }}
                    >
                        Create Another
                    </span>
                </div>
            </div>
        )
    }

    const startMin = today
    const endMin = newStartDate || today

    return (
        <div className="container">
            <Link href="/admin" className="nav-link">← Back to Admin</Link>

            <h1 style={{ marginTop: '1rem' }}>➕ Create New Event</h1>
            <h2>Set up a new hangout for your friends</h2>

            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Event Title *
            </label>
            <input
                type="text"
                className="input-field"
                placeholder="e.g. Summer BBQ, Game Night..."
                value={newTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
            />

            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Description (optional)
            </label>
            <input
                type="text"
                className="input-field"
                placeholder="e.g. Let's find a day to hang out!"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
            />

            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                URL Slug *
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    /respond/
                </span>
                <input
                    type="text"
                    className="input-field"
                    style={{ marginBottom: 0 }}
                    placeholder="summer-bbq"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Start Date *
                    </label>
                    <input
                        type="date"
                        className="input-field"
                        value={newStartDate}
                        min={startMin}
                        max={newEndDate || undefined}
                        onChange={(e) => handleStartDateChange(e.target.value)}
                    />
                    <p style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '-0.5rem' }}>
                        Cannot be in the past
                    </p>
                </div>
                <div>
                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        End Date *
                    </label>
                    <input
                        type="date"
                        className="input-field"
                        value={newEndDate}
                        min={endMin}
                        onChange={(e) => handleEndDateChange(e.target.value)}
                    />
                    <p style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '-0.5rem' }}>
                        {newStartDate ? 'Must be on or after start date' : 'Cannot be in the past'}
                    </p>
                </div>
            </div>

            {newStartDate && newEndDate && newEndDate >= newStartDate && (
                <>
                    <h2 style={{ marginTop: '1rem' }}>Block Off Dates (Optional)</h2>
                    <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        🚫 Tap dates to block them. Blocked dates won&apos;t be shown to your friends.
                    </p>

                    <div className="legend" style={{ marginBottom: '0.5rem' }}>
                        <span>
                            <span className="legend-dot" style={{ background: '#065f46', border: '2px solid #10b981' }} />
                            Available to friends
                        </span>
                        <span>
                            <span className="legend-dot" style={{ background: '#7f1d1d', border: '2px solid #ef4444' }} />
                            Blocked
                        </span>
                    </div>

                    <AdminCalendar
                        startDate={newStartDate}
                        endDate={newEndDate}
                        blockedDates={newBlockedDates}
                        onToggleBlocked={toggleBlockedDate}
                    />

                    {newBlockedDates.length > 0 && (
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                            {newBlockedDates.length} date{newBlockedDates.length !== 1 ? 's' : ''} blocked
                        </p>
                    )}
                </>
            )}

            {createError && (
                <p style={{ color: '#ef4444', margin: '0.5rem 0' }}>{createError}</p>
            )}

            <button
                className="submit-btn"
                onClick={createEvent}
                disabled={createLoading}
                style={{ marginTop: '1rem' }}
            >
                {createLoading ? 'Creating...' : '🎉 Create Event'}
            </button>
        </div>
    )
}
