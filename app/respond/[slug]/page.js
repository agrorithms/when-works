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

    const [name, setName] = useState(() => {
        if (typeof window === 'undefined') return ''
        return localStorage.getItem(NAME_STORAGE_KEY) || ''
    })
    const [includesSO, setIncludesSO] = useState(false)
    const [mode, setMode] = useState('available')
    const [confirmed, setConfirmed] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [responseId, setResponseId] = useState(null)
    const [sessionStarted, setSessionStarted] = useState(false)
    const [sessionLoading, setSessionLoading] = useState(false)
    const [responseCount, setResponseCount] = useState(0)
    const [confirmedResponses, setConfirmedResponses] = useState([])
    const [displayName, setDisplayName] = useState('')

    const [availableDates, setAvailableDates] = useState([])
    const [unavailableDates, setUnavailableDates] = useState([])

    const availableDatesRef = useRef([])
    const unavailableDatesRef = useRef([])
    const nameRef = useRef('')
    const savedModeRef = useRef('available')
    const responseIdRef = useRef(null)
    const saveTimeout = useRef(null)
    const nameTimeout = useRef(null)
    const includesSOTimeout = useRef(null)
    const sessionStarting = useRef(false)
    const eventRef = useRef(null)
    const isSaving = useRef(false)

    const [saveStatus, setSaveStatus] = useState('idle')
    const [hasMadeSelection, setHasMadeSelection] = useState(false)
    const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
    const [emptyConfirmChecked, setEmptyConfirmChecked] = useState(false)
    const [pendingDate, setPendingDate] = useState(null)

    const selectedDates = mode === 'available' ? availableDates : unavailableDates
    const getAttendeeWeight = (response) => response.includes_so ? 2 : 1

    useEffect(() => { availableDatesRef.current = availableDates }, [availableDates])
    useEffect(() => { unavailableDatesRef.current = unavailableDates }, [unavailableDates])
    useEffect(() => { responseIdRef.current = responseId }, [responseId])
    useEffect(() => { nameRef.current = name }, [name])

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

                const { data: responderRows } = await supabase
                    .from('responses')
                    .select('includes_so')
                    .eq('event_id', data[0].id)
                const attendeeCount = (responderRows || []).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
                setResponseCount(attendeeCount)

                if (data[0].show_availability_counts) {
                    const { data: confirmedData } = await supabase
                        .from('responses')
                        .select('id, response_type, dates, includes_so')
                        .eq('event_id', data[0].id)
                        .eq('confirmed', true)
                    setConfirmedResponses(confirmedData || [])
                } else {
                    setConfirmedResponses([])
                }
            }
            setEventLoading(false)
        }

        fetchEvent()
    }, [slug])

    // Debounced name save — updates DB when name changes while session is active
    useEffect(() => {
        if (!responseIdRef.current || !sessionStarted) return

        if (nameTimeout.current) clearTimeout(nameTimeout.current)

        nameTimeout.current = setTimeout(async () => {
            const currentResponseId = responseIdRef.current
            if (!currentResponseId) return

            const trimmedName = name.trim()
            const newDisplayName = trimmedName || displayName
            const newInternalName = trimmedName ? trimmedName.toLowerCase() : null

            const updateData = { display_name: newDisplayName }

            // Only update internal name if they provided a real name
            if (newInternalName && !displayName.startsWith('Guest #')) {
                updateData.name = newInternalName
            } else if (newInternalName) {
                updateData.name = newInternalName
            }

            await supabase
                .from('responses')
                .update(updateData)
                .eq('id', currentResponseId)

            // Update localStorage
            if (trimmedName) {
                localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
                localStorage.setItem(getSessionKey(slug), newInternalName)
                setDisplayName(trimmedName)
            }
        }, 1000)

        return () => {
            if (nameTimeout.current) clearTimeout(nameTimeout.current)
        }
    }, [name, sessionStarted, displayName, slug])

    useEffect(() => {
        if (!responseIdRef.current || !sessionStarted) return

        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)

        includesSOTimeout.current = setTimeout(async () => {
            const currentResponseId = responseIdRef.current
            if (!currentResponseId) return

            await supabase
                .from('responses')
                .update({ includes_so: includesSO })
                .eq('id', currentResponseId)

            if (eventRef.current) {
                const { data: responderRows } = await supabase
                    .from('responses')
                    .select('includes_so')
                    .eq('event_id', eventRef.current.id)
                const attendeeCount = (responderRows || []).reduce((sum, r) => sum + getAttendeeWeight(r), 0)
                setResponseCount(attendeeCount)
            }
        }, 600)

        return () => {
            if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)
        }
    }, [includesSO, sessionStarted])

    const scheduleSave = useCallback(() => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current)

        saveTimeout.current = setTimeout(async () => {
            const currentResponseId = responseIdRef.current
            if (!currentResponseId) return
            if (isSaving.current) return

            isSaving.current = true
            setSaveStatus('saving')

            const currentMode = savedModeRef.current
            const datesToSave = currentMode === 'available'
                ? [...availableDatesRef.current]
                : [...unavailableDatesRef.current]

            const { error: updateError } = await supabase
                .from('responses')
                .update({
                    response_type: currentMode,
                    dates: datesToSave.sort(),
                    confirmed: false
                })
                .eq('id', currentResponseId)

            if (updateError) console.error('Auto-save error:', updateError)

            isSaving.current = false
            setSaveStatus('saved')

            setTimeout(() => {
                setSaveStatus(prev => prev === 'saved' ? 'idle' : prev)
            }, 2000)
        }, 2000)
    }, [])

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
        const lookupName = sessionInternalName || (sessionDisplayName ? sessionDisplayName.trim().toLowerCase() : null)

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
                responseIdRef.current = prev.id
                setMode(prev.response_type)
                savedModeRef.current = prev.response_type
                setConfirmed(prev.confirmed)
                setDisplayName(prev.display_name)
                setIncludesSO(Boolean(prev.includes_so))

                if (!prev.name.startsWith('guest_')) {
                    setName(prev.display_name)
                }

                if (prev.response_type === 'available') {
                    setAvailableDates(prev.dates || [])
                    availableDatesRef.current = prev.dates || []
                    setUnavailableDates([])
                    unavailableDatesRef.current = []
                } else {
                    setUnavailableDates(prev.dates || [])
                    unavailableDatesRef.current = prev.dates || []
                    setAvailableDates([])
                    availableDatesRef.current = []
                }

                localStorage.setItem(getSessionKey(slug), prev.name)

                setSessionStarted(true)
                setSessionLoading(false)
                sessionStarting.current = false
                return
            }
        }

        const trimmedName = (sessionDisplayName || nameRef.current).trim()
        const guestNumber = await getNextGuestNumber(currentEvent.id)
        const finalDisplayName = trimmedName || `Guest #${guestNumber}`
        const finalInternalName = trimmedName ? trimmedName.toLowerCase() : `guest_${guestNumber}`

        const { data, error: insertError } = await supabase
            .from('responses')
            .insert({
                name: finalInternalName,
                display_name: finalDisplayName,
                includes_so: includesSO,
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
        responseIdRef.current = data[0].id
        setDisplayName(finalDisplayName)
        setResponseCount(prev => prev + getAttendeeWeight({ includes_so: includesSO }))

        localStorage.setItem(getSessionKey(slug), finalInternalName)
        if (trimmedName) {
            localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
        }

        setSessionStarted(true)
        setSessionLoading(false)
        sessionStarting.current = false
    }, [includesSO, slug])

    const processDateToggle = useCallback((dateStr) => {
        setHasMadeSelection(true)
        savedModeRef.current = mode
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)

        if (mode === 'available') {
            setAvailableDates(prev => {
                const next = prev.includes(dateStr)
                    ? prev.filter(d => d !== dateStr)
                    : [...prev, dateStr]
                availableDatesRef.current = next
                return next
            })
        } else {
            setUnavailableDates(prev => {
                const next = prev.includes(dateStr)
                    ? prev.filter(d => d !== dateStr)
                    : [...prev, dateStr]
                unavailableDatesRef.current = next
                return next
            })
        }

        scheduleSave()
    }, [mode, scheduleSave])

    const toggleDate = useCallback((dateStr) => {
        if (!sessionStarted && !sessionStarting.current) {
            setPendingDate(dateStr)
            startSession(nameRef.current.trim() || null)
            return
        }

        if (sessionLoading) {
            setPendingDate(dateStr)
            return
        }

        processDateToggle(dateStr)
    }, [sessionStarted, sessionLoading, startSession, processDateToggle])

    // Auto-start session
    useEffect(() => {
        if (!event || sessionStarted || sessionStarting.current) return

        const timeoutId = setTimeout(() => {
            const sessionName = localStorage.getItem(getSessionKey(slug))
            if (sessionName) {
                startSession(null, sessionName)
                return
            }

            const savedName = localStorage.getItem(NAME_STORAGE_KEY)
            if (savedName) {
                startSession(savedName)
            }
        }, 0)

        return () => clearTimeout(timeoutId)
    }, [event, sessionStarted, slug, startSession])

    // Process pending date
    useEffect(() => {
        if (sessionStarted && pendingDate) {
            const timeoutId = setTimeout(() => {
                processDateToggle(pendingDate)
                setPendingDate(null)
            }, 0)
            return () => clearTimeout(timeoutId)
        }
    }, [sessionStarted, pendingDate, processDateToggle])

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

        if (saveTimeout.current) clearTimeout(saveTimeout.current)
        if (nameTimeout.current) clearTimeout(nameTimeout.current)
        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)

        setLoading(true)
        setError('')

        const trimmedName = name.trim()

        const updateData = {
            includes_so: includesSO,
            response_type: mode,
            dates: datesToConfirm.sort(),
            confirmed: true
        }

        if (trimmedName) {
            updateData.display_name = trimmedName
            updateData.name = trimmedName.toLowerCase()
            localStorage.setItem(getSessionKey(slug), trimmedName.toLowerCase())
            localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
            setDisplayName(trimmedName)
        }

        const { error: updateError } = await supabase
            .from('responses')
            .update(updateData)
            .eq('id', responseId)

        if (updateError) {
            setError('Something went wrong. Please try again.')
        } else {
            setConfirmed(true)
            savedModeRef.current = mode
            if (event?.show_availability_counts) {
                const { data: confirmedData } = await supabase
                    .from('responses')
                    .select('id, response_type, dates, includes_so')
                    .eq('event_id', event.id)
                    .eq('confirmed', true)
                setConfirmedResponses(confirmedData || [])
            }
        }

        setLoading(false)
    }

    const handleReset = () => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current)
        if (nameTimeout.current) clearTimeout(nameTimeout.current)
        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)
        setSessionStarted(false)
        setResponseId(null)
        responseIdRef.current = null
        setAvailableDates([])
        setUnavailableDates([])
        availableDatesRef.current = []
        unavailableDatesRef.current = []
        setHasMadeSelection(false)
        setConfirmed(false)
        setName('')
        setIncludesSO(false)
        setDisplayName('')
        setMode('available')
        setSaveStatus('idle')
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
    const otherConfirmedResponses = confirmedResponses.filter(r => r.id !== responseId)
    const availabilityTotal = otherConfirmedResponses.reduce((sum, r) => sum + getAttendeeWeight(r), 0)
    const availabilityCounts = {}

    if (event?.show_availability_counts && event?.date_range_start && event?.date_range_end) {
        const start = new Date(event.date_range_start + 'T12:00:00')
        const end = new Date(event.date_range_end + 'T12:00:00')
        const blocked = event.blocked_dates || []

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0]
            if (blocked.includes(dateStr)) continue

            let availableCount = 0
            for (const r of otherConfirmedResponses) {
                const dates = r.dates || []
                const hasDate = dates.includes(dateStr)
                const isAvailable = r.response_type === 'available' ? hasDate : !hasDate
                if (isAvailable) availableCount += getAttendeeWeight(r)
            }
            availabilityCounts[dateStr] = availableCount
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
                {includesSO && (
                    <p style={{ color: '#94a3b8', marginTop: '0.25rem', fontSize: '0.9rem' }}>
                        👥 Submitted for both you and your SO
                    </p>
                )}

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
            {/* Header */}
            <div style={{
                background: '#1e293b', borderRadius: '10px', padding: '1rem',
                marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '1rem'
            }}>
                <div>
                    <h1 style={{ marginBottom: '0.25rem', fontSize: '1.3rem' }}>📅 {event.title}</h1>
                    {event.description && (
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{event.description}</p>
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
                        👥 {responseCount - 1} responded
                    </div>
                </div>
            </div>

            <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                cursor: 'pointer',
                padding: '0.75rem',
                borderRadius: '10px',
                background: '#1e293b',
                border: '2px solid #334155',
                marginBottom: '1rem'
            }}>
                <input
                    type="checkbox"
                    checked={includesSO}
                    onChange={(e) => setIncludesSO(e.target.checked)}
                    style={{
                        width: '20px',
                        height: '20px',
                        marginTop: '2px',
                        accentColor: '#6366f1',
                        cursor: 'pointer',
                        flexShrink: 0
                    }}
                />
                <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>
                    I&apos;m submitting for me and my SO
                </span>
            </label>

            {/* Name field — always editable */}
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
                        style={{ marginBottom: 0 }}
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

                {saveStatus === 'saving' && (
                    <span style={{
                        color: '#f59e0b', fontSize: '0.8rem', background: '#422006',
                        padding: '0.3rem 0.6rem', borderRadius: '6px', whiteSpace: 'nowrap'
                    }}>💾 Saving...</span>
                )}
                {saveStatus === 'saved' && (
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
                    userSelect: 'none',
                    touchAction: 'manipulation'
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
                <p style={{
                    color: mode === 'available' ? '#6ee7b7' : '#fca5a5',
                    fontSize: '0.8rem', opacity: 0.8
                }}>
                    {selectedDates.length} day{selectedDates.length !== 1 ? 's' : ''} selected
                </p>
            </div>


            {otherModeDates.length > 0 && (
                <p style={{
                    color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1rem',
                    background: '#1e293b', padding: '0.5rem 0.75rem', borderRadius: '8px'
                }}>
                    💾 You have {otherModeDates.length} day{otherModeDates.length !== 1 ? 's' : ''} saved
                    as {otherModeLabel}. Switch back to view them.
                </p>
            )}

            {event.show_availability_counts && (
                <p style={{
                    color: '#94a3b8',
                    fontSize: '0.8rem',
                    marginBottom: '0.75rem',
                    textAlign: 'center'
                }}>
                    Dates now show available/responded counts, so you can see which days are already popular
                    ({availabilityTotal} other confirmed so far).
                </p>
            )}

            {/* Calendar */}
            <Calendar
                selectedDates={selectedDates}
                onToggleDate={toggleDate}
                mode={mode}
                startDate={event.date_range_start}
                endDate={event.date_range_end}
                blockedDates={event.blocked_dates || []}
                showAvailabilityCounts={event.show_availability_counts}
                availabilityCounts={availabilityCounts}
                availabilityTotal={availabilityTotal}
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

            {/* Anonymous indicator */}
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
                    : 'Your selections are auto-saved as you tap. Hit confirm when you\'re done!'
                }
            </p>
        </div>
    )
}
