'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import Calendar from '../../../components/Calendar'
import Link from 'next/link'

const NAME_STORAGE_KEY = 'when_works_name'
const getSessionKey = (slug) => `when_works_session_${slug}`

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
    const [sessionStarted, setSessionStarted] = useState(false)
    const [sessionLoading, setSessionLoading] = useState(false)
    const [responseCount, setResponseCount] = useState(0)
    const [displayName, setDisplayName] = useState('')
    const saveTimeout = useRef(null)
    const sessionStarting = useRef(false)
    const eventRef = useRef(null)

    // Separate selections for each mode
    const [availableDates, setAvailableDates] = useState([])
    const [unavailableDates, setUnavailableDates] = useState([])

    // Track which mode was last saved to DB
    const [savedMode, setSavedMode] = useState('available')
    const [hasMadeSelection, setHasMadeSelection] = useState(false)

    // Empty submission confirmation
    const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
    const [emptyConfirmChecked, setEmptyConfirmChecked] = useState(false)

    // Pending date tap
    const [pendingDate, setPendingDate] = useState(null)

    // Get the active date list based on current mode
    const selectedDates = mode === 'available' ? availableDates : unavailableDates

    // Load saved name from localStorage on mount
    useEffect(() => {
        const savedName = localStorage.getItem(NAME_STORAGE_KEY)
        if (savedName) {
            setName(savedName)
        }
    }, [])

    // Fetch event
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
                eventRef.current = data[0]

                const { count } = await supabase
                    .from('responses')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', data[0].id)
                setResponseCount(count || 0)
            }
            setEventLoading(false)
        }

        fetchEvent()
    }, [slug])

    // Auto-start session when we have the event loaded
    useEffect(() => {
        if (!event || sessionStarted || sessionStarting.current) return

        // First check if there's a session stored for this specific event
        const sessionName = localStorage.getItem(getSessionKey(slug))
        if (sessionName) {
            startSession(null, sessionName)
            return
        }

        // Otherwise check if they have a saved display name
        const savedName = localStorage.getItem(NAME_STORAGE_KEY)
        if (savedName) {
            startSession(savedName)
        }
    }, [event])

    // Process pending date after session starts
    useEffect(() => {
        if (sessionStarted && pendingDate) {
            processDateToggle(pendingDate)
            setPendingDate(null)
        }
    }, [sessionStarted, pendingDate])

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
                confirmed: false,
                display_name: name.trim() || displayName
            })
            .eq('id', responseId)

        if (updateError) console.error('Auto-save error:', updateError)
        setSaving(false)
    }

    const getNextGuestNumber = async (eventId) => {
        const { data } = await supabase
            .from('responses')
            .select('display_name')
            .eq('event_id', eventId)
            .like('display_name', 'Guest %')

        if (!data) return 1

        const guestNumbers = data
            .map(r => {
                const match = r.display_name.match(/Guest #(\d+)/)
                return match ? parseInt(match[1]) : 0
            })
            .filter(n => n > 0)

        return guestNumbers.length > 0 ? Math.max(...guestNumbers) + 1 : 1
    }

    const startSession = useCallback(async (sessionDisplayName, sessionInternalName) => {
        if (sessionStarting.current) return
        if (!eventRef.current) return

        sessionStarting.current = true
        setSessionLoading(true)
        setError('')

        const currentEvent = eventRef.current

        // Determine the internal name to look up
        const lookupName = sessionInternalName || (sessionDisplayName ? sessionDisplayName.trim().toLowerCase() : null)

        // If we have a name to look up, try to find existing response
        if (lookupName) {
            const { data: existing } = await supabase
                .from('responses')
                .select('*')
                .eq('name', lookupName)
                .eq('event_id', currentEvent.id)
                .limit(1)

            if (existing && existing.length > 0) {
                const prev = existing[0]
                setResponseId(prev.id)
                setMode(prev.response_type)
                setSavedMode(prev.response_type)
                setConfirmed(prev.confirmed)
                setDisplayName(prev.display_name)

                // Pre-fill name field if it was a named response
                if (!prev.name.startsWith('guest_')) {
                    setName(prev.display_name)
                }

                if (prev.response_type === 'available') {
                    setAvailableDates(prev.dates || [])
                    setUnavailableDates([])
                } else {
                    setUnavailableDates(prev.dates || [])
                    setAvailableDates([])
                }

                // Save session for this event
                localStorage.setItem(getSessionKey(slug), prev.name)

                setSessionStarted(true)
                setSessionLoading(false)
                sessionStarting.current = false
                return
            }
        }

        // Create new response
        const trimmedName = (sessionDisplayName || name).trim()
        const guestNumber = await getNextGuestNumber(currentEvent.id)
        const finalDisplayName = trimmedName || `Guest #${guestNumber}`
        const finalInternalName = trimmedName ? trimmedName.toLowerCase() : `guest_${guestNumber}`

        const { data, error: insertError } = await supabase
            .from('responses')
            .insert({
                name: finalInternalName,
                display_name: finalDisplayName,
                response_type: 'available',
                dates: [],
                confirmed: false,
                event_id: currentEvent.id
            })
            .select()

        if (insertError) {
            setError('Something went wrong. Please try again.')
            console.error(insertError)
            sessionStarting.current = false
            setSessionLoading(false)
            return
        }

        setResponseId(data[0].id)
        setDisplayName(finalDisplayName)
        setResponseCount(prev => prev + 1)

        // Save session for this event (works for both named and anonymous)
        localStorage.setItem(getSessionKey(slug), finalInternalName)

        // Save display name if provided
        if (trimmedName) {
            localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
        }

        setSessionStarted(true)
        setSessionLoading(false)
        sessionStarting.current = false
    }, [name, slug])

    const handleNameBlur = () => {
        if (!sessionStarted && !sessionStarting.current && event) {
            startSession(name.trim() || null)
        }
    }

    const handleNameKeyDown = (e) => {
        if (e.key === 'Enter' && !sessionStarted && !sessionStarting.current && event) {
            e.target.blur()
            startSession(name.trim() || null)
        }
    }

    const processDateToggle = (dateStr) => {
        setHasMadeSelection(true)
        setSavedMode(mode)

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

    const toggleDate = (dateStr) => {
        if (!sessionStarted && !sessionStarting.current) {
            setPendingDate(dateStr)
            startSession(name.trim() || null)
            return
        }

        if (sessionLoading) {
            setPendingDate(dateStr)
            return
        }

        processDateToggle(dateStr)
    }

    const handleModeChange = () => {
        const newMode = mode === 'available' ? 'unavailable' : 'available'
        setMode(newMode)
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)
    }

    const handleConfirm = async () => {
        const datesToConfirm = mode === 'available' ? availableDates : unavailableDates

        if (datesToConfirm.length === 0 && !emptyConfirmChecked) {
            setShowEmptyConfirm(true)
            return
        }

        setLoading(true)
        setError('')

        const updateData = {
            response_type: mode,
            dates: datesToConfirm.sort(),
            confirmed: true
        }

        // Update name if they entered one after starting session
        if (name.trim() && name.trim() !== displayName) {
            updateData.display_name = name.trim()
            updateData.name = name.trim().toLowerCase()
            // Update session key with new name
            localStorage.setItem(getSessionKey(slug), name.trim().toLowerCase())
            localStorage.setItem(NAME_STORAGE_KEY, name.trim())
            setDisplayName(name.trim())
        }

        const { error: updateError } = await supabase
            .from('responses')
            .update(updateData)
            .eq('id', responseId)

        if (updateError) {
            setError('Something went wrong. Please try again.')
        } else {
            setConfirmed(true)
            setSavedMode(mode)
        }

        setLoading(false)
    }

    const handleReset = () => {
        setSessionStarted(false)
        setResponseId(null)
        setAvailableDates([])
        setUnavailableDates([])
        setHasMadeSelection(false)
        setConfirmed(false)
        setName('')
        setDisplayName('')
        setMode('available')
        localStorage.removeItem(NAME_STORAGE_KEY)
        localStorage.removeItem(getSessionKey(slug))
        sessionStarting.current = false
    }

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

    const getDaysUntilDeadline = () => {
        if (!event || !event.response_deadline) return null
        const deadline = new Date(event.response_deadline + 'T23:59:59')
        const today = new Date()
        const diff = deadline - today
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
        return days > 0 ? days : 0
    }

    const daysLeft = getDaysUntilDeadline()

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

    if (confirmed) {
        const confirmedDates = mode === 'available' ? availableDates : unavailableDates
        const isEmptySubmission = confirmedDates.length === 0

        return (
            <div className="container success-message">
                <h1>✅</h1>
                <h1 style={{ color: '#10b981' }}>Confirmed!</h1>
                <h2>Your availability for &quot;{event.title}&quot; has been locked in.</h2>

                <p style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    Responding as: <strong>{name.trim() || displayName}</strong>
                </p>

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

    const otherModeDates = mode === 'available' ? unavailableDates : availableDates
    const otherModeLabel = mode === 'available' ? 'unavailable' : 'available'

    return (
        <div className="container">
            {/* Header with deadline and response count */}
            <div style={{
                background: '#1e293b', borderRadius: '10px', padding: '1rem',
                marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '1rem'
            }}>
                <div>
                    <h1 style={{ marginBottom: '0.25rem', fontSize: '1.3rem' }}>📅 {event.title}</h1>
                    {event.description && (
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                            {event.description}
                        </p>
                    )}
                </div>

                <div style={{ textAlign: 'right' }}>
                    {daysLeft !== null && (
                        <div style={{
                            background: daysLeft <= 2 ? '#7f1d1d' : '#1e3a2f',
                            border: daysLeft <= 2 ? '2px solid #ef4444' : '2px solid #10b981',
                            color: daysLeft <= 2 ? '#fca5a5' : '#a7f3d0',
                            padding: '0.5rem 0.75rem', borderRadius: '8px',
                            fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem'
                        }}>
                            {daysLeft === 0 ? '⏰ Due today!' : `⏰ ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}
                        </div>
                    )}
                    <div style={{
                        background: '#312e81', border: '2px solid #6366f1',
                        color: '#c7d2fe', padding: '0.5rem 0.75rem', borderRadius: '8px',
                        fontSize: '0.8rem', fontWeight: 600
                    }}>
                        👥 {responseCount} responded
                    </div>
                </div>
            </div>

            {/* Name field — optional */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                marginBottom: '1rem'
            }}>
                <div style={{ flex: 1 }}>
                    <input
                        type="text"
                        className="input-field"
                        placeholder="Your name (optional)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={handleNameBlur}
                        onKeyDown={handleNameKeyDown}
                        disabled={sessionStarted}
                        style={{
                            marginBottom: 0,
                            opacity: sessionStarted ? 0.7 : 1,
                            cursor: sessionStarted ? 'default' : 'text'
                        }}
                    />
                </div>

                {sessionStarted && (
                    <button
                        onClick={handleReset}
                        style={{
                            background: '#334155', color: '#94a3b8', border: 'none',
                            padding: '0.5rem 0.75rem', borderRadius: '8px',
                            cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap'
                        }}
                    >
                        Reset
                    </button>
                )}

                {/* Save status */}
                {saving && (
                    <span style={{
                        color: '#f59e0b', fontSize: '0.8rem', background: '#422006',
                        padding: '0.3rem 0.6rem', borderRadius: '6px', whiteSpace: 'nowrap'
                    }}>💾 Saving...</span>
                )}
                {!saving && responseId && hasMadeSelection && (
                    <span style={{
                        color: '#10b981', fontSize: '0.8rem', background: '#052e16',
                        padding: '0.3rem 0.6rem', borderRadius: '6px', whiteSpace: 'nowrap'
                    }}>✓ Saved</span>
                )}
            </div>

            {sessionLoading && (
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Loading your session...
                </p>
            )}

            {error && <p style={{ color: '#ef4444', margin: '0 0 1rem 0' }}>{error}</p>}

            {/* Mode description text */}
            <p style={{
                color: '#94a3b8',
                fontSize: '0.85rem',
                marginBottom: '0.5rem',
                textAlign: 'center'
            }}>
                {mode === 'available'
                    ? 'Click below if it would be easier to choose only dates you are NOT available'
                    : 'Click below if it would be easier to choose only dates you ARE available'}
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

            {/* Clickable mode banner */}
            <div
                onClick={handleModeChange}
                style={{
                    background: mode === 'available' ? '#065f46' : '#7f1d1d',
                    border: mode === 'available' ? '2px solid #10b981' : '2px solid #ef4444',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    userSelect: 'none'
                }}
            >
                <p style={{
                    color: mode === 'available' ? '#a7f3d0' : '#fca5a5',
                    fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem'
                }}>
                    {mode === 'available'
                        ? '✅ Select the days you ARE available'
                        : '❌ Select the days you are NOT available'}
                </p>
                {selectedDates.length > 0 && (
                    <p style={{
                        color: mode === 'available' ? '#6ee7b7' : '#fca5a5',
                        fontSize: '0.8rem', opacity: 0.8
                    }}>
                        {selectedDates.length} day{selectedDates.length !== 1 ? 's' : ''} selected
                    </p>
                )}
            </div>

            <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {mode === 'available'
                    ? '💡 Tap the days you CAN hang out. All other days will be assumed unavailable (only select days under one of the above modes).'
                    : '💡 Tap the days you CANNOT hang out. All other days will be assumed available (only select days under one of the above modes).'}
            </p>

            {/* Calendar — always visible */}
            <Calendar
                selectedDates={selectedDates}
                onToggleDate={toggleDate}
                mode={mode}
                startDate={event.date_range_start}
                endDate={event.date_range_end}
                blockedDates={event.blocked_dates || []}
            />

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

            {/* Anonymous warning before confirm */}
            {sessionStarted && !name.trim() && (
                <div style={{
                    background: '#1e3a2f',
                    border: '2px solid #10b981',
                    borderRadius: '10px',
                    padding: '0.75rem',
                    marginTop: '1rem',
                    marginBottom: '0.5rem',
                    fontSize: '0.85rem',
                    color: '#a7f3d0',
                    textAlign: 'center'
                }}>
                    👤 You&apos;re responding as <strong>{displayName}</strong> — add your name above to personalize
                </div>
            )}

            {/* Confirm button */}
            {sessionStarted && (
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
                            : `✅ Confirm as ${name.trim() || displayName}`
                    }
                </button>
            )}

            <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.75rem', textAlign: 'center' }}>
                {!sessionStarted
                    ? 'Tap a date to get started — name is optional'
                    : (
                        <>
                            Your selections are auto-saved as you tap. Hit confirm when you&apos;re done!
                        </>
                    )
                }
            </p>
        </div>
    )
}
