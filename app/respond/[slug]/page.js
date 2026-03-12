'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import Calendar from '../../../components/Calendar'
import Link from 'next/link'

export default function EventRespondPage() {
    const params = useParams()
    const slug = params.slug

    const [event, setEvent] = useState(null)
    const [eventLoading, setEventLoading] = useState(true)
    const [eventNotFound, setEventNotFound] = useState(false)

    const [name, setName] = useState('')
    const [mode, setMode] = useState('available')
    const [confirmed, setConfirmed] = useState(false)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [responseId, setResponseId] = useState(null)
    const [nameSubmitted, setNameSubmitted] = useState(false)
    const saveTimeout = useRef(null)

    // Separate selections for each mode
    const [availableDates, setAvailableDates] = useState([])
    const [unavailableDates, setUnavailableDates] = useState([])

    // Track which mode was last saved to DB
    const [savedMode, setSavedMode] = useState('available')
    const [hasMadeSelection, setHasMadeSelection] = useState(false)

    // Empty submission confirmation
    const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
    const [emptyConfirmChecked, setEmptyConfirmChecked] = useState(false)

    // Get the active date list based on current mode
    const selectedDates = mode === 'available' ? availableDates : unavailableDates

    useEffect(() => {
        const fetchEvent = async () => {
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('slug', slug)
                .limit(1)

            if (error || !data || data.length === 0) {
                setEventNotFound(true)
            } else {
                setEvent(data[0])
            }
            setEventLoading(false)
        }

        fetchEvent()
    }, [slug])

    // Auto-save when dates change
    useEffect(() => {
        if (!responseId || !hasMadeSelection) return

        if (saveTimeout.current) clearTimeout(saveTimeout.current)

        saveTimeout.current = setTimeout(() => {
            autoSave()
        }, 500)

        return () => {
            if (saveTimeout.current) clearTimeout(saveTimeout.current)
        }
    }, [availableDates, unavailableDates, savedMode])

    const autoSave = async () => {
        if (!responseId) return
        setSaving(true)

        const datesToSave = savedMode === 'available' ? availableDates : unavailableDates

        const { error: updateError } = await supabase
            .from('responses')
            .update({
                response_type: savedMode,
                dates: datesToSave.sort(),
                confirmed: false
            })
            .eq('id', responseId)

        if (updateError) console.error('Auto-save error:', updateError)
        setSaving(false)
    }

    const startSession = async () => {
        if (!name.trim()) {
            setError('Please enter your name!')
            return
        }

        setLoading(true)
        setError('')

        const cleanName = name.trim().toLowerCase()

        const { data: existing } = await supabase
            .from('responses')
            .select('*')
            .eq('name', cleanName)
            .eq('event_id', event.id)
            .limit(1)

        if (existing && existing.length > 0) {
            const prev = existing[0]
            setResponseId(prev.id)
            setMode(prev.response_type)
            setSavedMode(prev.response_type)
            setConfirmed(prev.confirmed)

            if (prev.response_type === 'available') {
                setAvailableDates(prev.dates || [])
                setUnavailableDates([])
            } else {
                setUnavailableDates(prev.dates || [])
                setAvailableDates([])
            }

            setNameSubmitted(true)
        } else {
            const { data, error: insertError } = await supabase
                .from('responses')
                .insert({
                    name: cleanName,
                    display_name: name.trim(),
                    response_type: mode,
                    dates: [],
                    confirmed: false,
                    event_id: event.id
                })
                .select()

            if (insertError) {
                setError('Something went wrong. Please try again.')
                console.error(insertError)
            } else {
                setResponseId(data[0].id)
                setNameSubmitted(true)
            }
        }

        setLoading(false)
    }

    const toggleDate = (dateStr) => {
        setHasMadeSelection(true)
        setSavedMode(mode)

        // Reset empty confirm state if they start selecting dates
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)

        if (mode === 'available') {
            setAvailableDates(prev =>
                prev.includes(dateStr)
                    ? prev.filter(d => d !== dateStr)
                    : [...prev, dateStr]
            )
        } else {
            setUnavailableDates(prev =>
                prev.includes(dateStr)
                    ? prev.filter(d => d !== dateStr)
                    : [...prev, dateStr]
            )
        }
    }

    const handleModeChange = (newMode) => {
        setMode(newMode)
        // Reset empty confirm when switching modes
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)
    }

    const handleConfirm = async () => {
        const datesToConfirm = mode === 'available' ? availableDates : unavailableDates

        // If empty and user hasn't acknowledged the empty confirmation
        if (datesToConfirm.length === 0 && !emptyConfirmChecked) {
            setShowEmptyConfirm(true)
            return
        }

        setLoading(true)
        setError('')

        const { error: updateError } = await supabase
            .from('responses')
            .update({
                response_type: mode,
                dates: datesToConfirm.sort(),
                confirmed: true
            })
            .eq('id', responseId)

        if (updateError) {
            setError('Something went wrong. Please try again.')
        } else {
            setConfirmed(true)
            setSavedMode(mode)
        }

        setLoading(false)
    }

    // Build the confirmation message for empty submissions
    const getEmptyConfirmMessage = () => {
        if (mode === 'available') {
            return 'You have not selected any available days. This means you are not available on any of the proposed dates.'
        } else {
            return 'You have not marked any days as unavailable. This means you are available on all of the proposed dates.'
        }
    }

    const getEmptyCheckboxLabel = () => {
        if (mode === 'available') {
            return 'Yes, I confirm that I am not available on any of the proposed dates'
        } else {
            return 'Yes, I confirm that I am available on all of the proposed dates'
        }
    }

    if (eventLoading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading event...</h2>
            </div>
        )
    }

    if (eventNotFound) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>Event Not Found</h1>
                <h2>This event link doesn&apos;t exist or may have been removed.</h2>
                <Link href="/" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← Back to Home
                </Link>
            </div>
        )
    }

    if (!nameSubmitted) {
        return (
            <div className="container">
                <h1 style={{ marginTop: '1rem' }}>📅 {event.title}</h1>
                {event.description && (
                    <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>{event.description}</p>
                )}
                <h2>First, tell us who you are</h2>

                <input
                    type="text"
                    className="input-field"
                    placeholder="Enter your name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && startSession()}
                />

                {error && <p style={{ color: '#ef4444', margin: '0.5rem 0' }}>{error}</p>}

                <button className="submit-btn" onClick={startSession} disabled={loading}>
                    {loading ? 'Loading...' : 'Continue →'}
                </button>
            </div>
        )
    }

    if (confirmed) {
        const confirmedDates = mode === 'available' ? availableDates : unavailableDates
        const isEmptySubmission = confirmedDates.length === 0

        return (
            <div className="container success-message">
                <h1>✅</h1>
                <h1 style={{ color: '#10b981' }}>Confirmed!</h1>
                <h2>Your availability for &quot;{event.title}&quot; has been locked in.</h2>

                {isEmptySubmission ? (
                    <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>
                        {mode === 'available'
                            ? '📭 You indicated that you are not available on any dates.'
                            : '🎉 You indicated that you are available on all dates.'}
                    </p>
                ) : (
                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
                        {confirmedDates.length} day{confirmedDates.length !== 1 ? 's' : ''} marked as {mode}
                    </p>
                )}

                <p style={{ marginTop: '1.5rem' }}>
                    <span
                        style={{ color: '#6366f1', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => {
                            setConfirmed(false)
                            setShowEmptyConfirm(false)
                            setEmptyConfirmChecked(false)
                        }}
                    >
                        Edit my response
                    </span>
                </p>
            </div>
        )
    }

    // Count for the inactive mode
    const otherModeDates = mode === 'available' ? unavailableDates : availableDates
    const otherModeLabel = mode === 'available' ? 'unavailable' : 'available'

    return (
        <div className="container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>📅 {event.title}</h1>
                {saving && (
                    <span style={{
                        color: '#f59e0b', fontSize: '0.8rem', background: '#422006',
                        padding: '0.3rem 0.6rem', borderRadius: '6px'
                    }}>💾 Saving...</span>
                )}
                {!saving && responseId && hasMadeSelection && (
                    <span style={{
                        color: '#10b981', fontSize: '0.8rem', background: '#052e16',
                        padding: '0.3rem 0.6rem', borderRadius: '6px'
                    }}>✓ Saved</span>
                )}
            </div>

            <h2>Hi {name.trim()}! Tap the days, then confirm.</h2>

            <p style={{ color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                I want to mark days I am:
            </p>

            <div className="mode-toggle">
                <button
                    className={mode === 'available' ? 'active-available' : ''}
                    onClick={() => handleModeChange('available')}
                >
                    ✅ Available
                    {availableDates.length > 0 && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', opacity: 0.8 }}>
                            ({availableDates.length})
                        </span>
                    )}
                </button>
                <button
                    className={mode === 'unavailable' ? 'active-unavailable' : ''}
                    onClick={() => handleModeChange('unavailable')}
                >
                    ❌ Not Available
                    {unavailableDates.length > 0 && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', opacity: 0.8 }}>
                            ({unavailableDates.length})
                        </span>
                    )}
                </button>
            </div>

            <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {mode === 'available'
                    ? '💡 Tap the days you CAN hang out. All other days will be assumed unavailable.'
                    : '💡 Tap the days you CANNOT hang out. All other days will be assumed available.'}
            </p>

            {otherModeDates.length > 0 && (
                <p style={{
                    color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1rem',
                    background: '#1e293b', padding: '0.5rem 0.75rem', borderRadius: '8px'
                }}>
                    💾 You have {otherModeDates.length} day{otherModeDates.length !== 1 ? 's' : ''} saved
                    as {otherModeLabel}. Switch back to view them.
                </p>
            )}

            <Calendar
                selectedDates={selectedDates}
                onToggleDate={toggleDate}
                mode={mode}
                startDate={event.date_range_start}
                endDate={event.date_range_end}
                blockedDates={event.blocked_dates || []}
            />

            {selectedDates.length > 0 && (
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                    {selectedDates.length} day{selectedDates.length !== 1 ? 's' : ''} selected as {mode}
                </p>
            )}

            {error && <p style={{ color: '#ef4444', margin: '0.5rem 0' }}>{error}</p>}

            {/* Empty submission confirmation */}
            {showEmptyConfirm && (
                <div style={{
                    background: '#1e293b',
                    border: '2px solid #f59e0b',
                    borderRadius: '12px',
                    padding: '1rem',
                    marginTop: '1rem',
                    marginBottom: '0.5rem'
                }}>
                    <p style={{ color: '#fbbf24', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                        ⚠️ No dates selected
                    </p>
                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        {getEmptyConfirmMessage()}
                    </p>

                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                        cursor: 'pointer',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        background: emptyConfirmChecked ? '#422006' : 'transparent',
                        transition: 'background 0.15s ease'
                    }}>
                        <input
                            type="checkbox"
                            checked={emptyConfirmChecked}
                            onChange={(e) => setEmptyConfirmChecked(e.target.checked)}
                            style={{
                                width: '20px',
                                height: '20px',
                                marginTop: '2px',
                                accentColor: '#f59e0b',
                                cursor: 'pointer',
                                flexShrink: 0
                            }}
                        />
                        <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>
                            {getEmptyCheckboxLabel()}
                        </span>
                    </label>
                </div>
            )}

            <button
                className="submit-btn"
                onClick={handleConfirm}
                disabled={loading || (showEmptyConfirm && !emptyConfirmChecked)}
                style={{ marginTop: '1rem' }}
            >
                {loading
                    ? 'Confirming...'
                    : showEmptyConfirm && emptyConfirmChecked
                        ? '✅ Confirm Empty Submission'
                        : `✅ Confirm as ${mode === 'available' ? 'Available' : 'Not Available'}`
                }
            </button>

            <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.75rem', textAlign: 'center' }}>
                Your selections are auto-saved as you tap. Hit confirm when you&apos;re done!
                <br />
                Confirming will save your <strong>{mode}</strong> selections.
            </p>
        </div>
    )
}
