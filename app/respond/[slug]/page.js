'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Calendar from '../../../components/Calendar'
import Link from 'next/link'

const NAME_STORAGE_KEY = 'when_works_name'
const SAVED_INVITES_KEY = 'when_works_saved_invites'
const getTokenKey = (slug) => `when_works_response_token_${slug}`

async function postRespond(slug, body) {
    const res = await fetch(`/api/respond/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed.')
    return data
}

function readStoredToken(slug) {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(getTokenKey(slug)) || null
}

export default function EventRespondPage() {
    const params = useParams()
    const slug = params.slug
    const { data: session } = useSession()

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
    const responseTokenRef = useRef(null)
    const saveTimeout = useRef(null)
    const nameTimeout = useRef(null)
    const includesSOTimeout = useRef(null)
    const sessionStarting = useRef(false)
    const eventRef = useRef(null)
    const isSaving = useRef(false)
    const pendingTogglesRef = useRef([])

    const [saveStatus, setSaveStatus] = useState('idle')
    const [hasMadeSelection, setHasMadeSelection] = useState(false)
    const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
    const [emptyConfirmChecked, setEmptyConfirmChecked] = useState(false)
    const [resetSnapshot, setResetSnapshot] = useState(null)
    const [hostingRoundInfo, setHostingRoundInfo] = useState(null)
    const [hostingInfoLoading, setHostingInfoLoading] = useState(false)
    const [profileName, setProfileName] = useState(null)
    const [profileLoaded, setProfileLoaded] = useState(false)

    const resolvedSignedInName = session?.user?.email
        ? (profileName || session.user.name || null)
        : null

    const selectedDates = mode === 'available' ? availableDates : unavailableDates
    const getAttendeeWeight = (response) => response.includes_so ? 2 : 1

    const isAvailableOnDate = useCallback((responseType, dates, dateStr) => {
        const selected = dates || []
        if (responseType === 'available') return selected.includes(dateStr)
        return !selected.includes(dateStr)
    }, [])

    useEffect(() => { availableDatesRef.current = availableDates }, [availableDates])
    useEffect(() => { unavailableDatesRef.current = unavailableDates }, [unavailableDates])
    useEffect(() => { responseIdRef.current = responseId }, [responseId])
    useEffect(() => { nameRef.current = name }, [name])
    // Fetch profile name for signed-in users
    useEffect(() => {
        let cancelled = false
        async function load() {
            if (!session?.user?.email) {
                await Promise.resolve()
                if (!cancelled) setProfileLoaded(true)
                return
            }
            try {
                const r = await fetch('/api/settings')
                const data = r.ok ? await r.json() : null
                if (!cancelled) {
                    if (data?.name) setProfileName(data.name)
                    setProfileLoaded(true)
                }
            } catch {
                if (!cancelled) setProfileLoaded(true)
            }
        }
        load()
        return () => { cancelled = true }
    }, [session?.user?.email])

    // Seed name state from profile when signed in — overrides any stale localStorage name
    useEffect(() => {
        if (!resolvedSignedInName) return
        if (name === resolvedSignedInName) return
        Promise.resolve().then(() => setName(resolvedSignedInName))
    }, [resolvedSignedInName]) // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch event
    useEffect(() => {
        const fetchEvent = async () => {
            try {
                const res = await fetch(`/api/respond/${slug}`)
                if (!res.ok) {
                    setEventNotFound(true)
                } else {
                    const data = await res.json()
                    setEvent(data.event)
                    eventRef.current = data.event
                    setResponseCount(data.attendeeCount || 0)
                    setConfirmedResponses(data.confirmedResponses || [])
                }
            } catch {
                setEventNotFound(true)
            }
            setEventLoading(false)
        }

        fetchEvent()
    }, [slug])

    useEffect(() => {
        if (!event) return

        if (typeof window === 'undefined') return

        try {
            const nextSaved = JSON.parse(localStorage.getItem(SAVED_INVITES_KEY) || '[]')
            if (!nextSaved.includes(slug)) {
                localStorage.setItem(SAVED_INVITES_KEY, JSON.stringify([...nextSaved, slug]))
            }
        } catch {
            localStorage.setItem(SAVED_INVITES_KEY, JSON.stringify([slug]))
        }
    }, [event, slug])

    // Debounced name save — updates DB when name changes while session is active
    useEffect(() => {
        if (!responseIdRef.current || !sessionStarted) return
        if (session?.user?.email) return

        if (nameTimeout.current) clearTimeout(nameTimeout.current)

        nameTimeout.current = setTimeout(async () => {
            if (!responseIdRef.current) return

            const trimmedName = name.trim()
            if (!trimmedName) return

            try {
                await postRespond(slug, {
                    action: 'save',
                    responseToken: responseTokenRef.current,
                    name: trimmedName,
                })
                localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
                setDisplayName(trimmedName)
            } catch {
                // Name save is retried on the next change or at confirm time
            }
        }, 1000)

        return () => {
            if (nameTimeout.current) clearTimeout(nameTimeout.current)
        }
    }, [name, sessionStarted, displayName, slug, session?.user?.email])

    useEffect(() => {
        if (!responseIdRef.current || !sessionStarted) return

        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)

        includesSOTimeout.current = setTimeout(async () => {
            if (!responseIdRef.current) return

            try {
                await postRespond(slug, {
                    action: 'save',
                    responseToken: responseTokenRef.current,
                    includes_so: includesSO,
                })

                const res = await fetch(`/api/respond/${slug}`)
                if (res.ok) {
                    const data = await res.json()
                    setResponseCount(data.attendeeCount || 0)
                }
            } catch {
                // Count refreshes on the next fetch
            }
        }, 600)

        return () => {
            if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)
        }
    }, [includesSO, sessionStarted, slug])

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

            try {
                await postRespond(slug, {
                    action: 'save',
                    responseToken: responseTokenRef.current,
                    response_type: currentMode,
                    dates: datesToSave.sort(),
                    confirmed: false,
                })
            } catch (updateError) {
                console.error('Auto-save error:', updateError)
            }

            isSaving.current = false
            setSaveStatus('saved')

            setTimeout(() => {
                setSaveStatus(prev => prev === 'saved' ? 'idle' : prev)
            }, 2000)
        }, 2000)
    }, [slug])

    const applyDateToggle = (dates, dateStr) => {
        return dates.includes(dateStr)
            ? dates.filter(d => d !== dateStr)
            : [...dates, dateStr]
    }

    const startSession = useCallback(async (sessionDisplayName) => {
        if (sessionStarting.current) return
        if (!eventRef.current) return

        sessionStarting.current = true
        setError('')

        const trimmedName = (sessionDisplayName || nameRef.current).trim()

        let payload
        try {
            payload = await postRespond(slug, {
                action: 'start',
                responseToken: readStoredToken(slug),
                name: trimmedName || null,
                includesSO,
            })
        } catch (startError) {
            setError('Something went wrong. Please try again.')
            console.error(startError)
            sessionStarting.current = false
            return
        }

        const { response: prev, created } = payload

        localStorage.setItem(getTokenKey(slug), prev.response_token)
        responseTokenRef.current = prev.response_token

        setResponseId(prev.id)
        responseIdRef.current = prev.id
        if (pendingTogglesRef.current.length === 0) {
            setMode(prev.response_type)
        }
        setConfirmed(prev.confirmed)
        setDisplayName(prev.display_name)
        setIncludesSO(Boolean(prev.includes_so))

        if (session?.user?.email) {
            if (resolvedSignedInName) setName(resolvedSignedInName)
        } else if (!created && prev.name && !prev.name.startsWith('guest_')) {
            setName(prev.display_name)
        }

        let nextAvailableDates = prev.response_type === 'available' ? (prev.dates || []) : []
        let nextUnavailableDates = prev.response_type === 'unavailable' ? (prev.dates || []) : []

        if (pendingTogglesRef.current.length > 0) {
            for (const { dateStr, toggleMode } of pendingTogglesRef.current) {
                if (toggleMode === 'available') {
                    nextAvailableDates = applyDateToggle(nextAvailableDates, dateStr)
                } else {
                    nextUnavailableDates = applyDateToggle(nextUnavailableDates, dateStr)
                }
            }
        }

        setAvailableDates(nextAvailableDates)
        availableDatesRef.current = nextAvailableDates
        setUnavailableDates(nextUnavailableDates)
        unavailableDatesRef.current = nextUnavailableDates

        if (created) {
            setResponseCount(count => count + getAttendeeWeight({ includes_so: prev.includes_so }))
            if (trimmedName) {
                localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
            }
        }

        setSessionStarted(true)
        if (pendingTogglesRef.current.length > 0) {
            pendingTogglesRef.current = []
            scheduleSave()
        }
        sessionStarting.current = false
    }, [includesSO, scheduleSave, slug, session, resolvedSignedInName])

    const processDateToggle = useCallback((dateStr) => {
        if (resetSnapshot) {
            setResetSnapshot(null)
        }
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
    }, [mode, resetSnapshot, scheduleSave])

    const toggleDate = useCallback((dateStr) => {
        if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }

        if (!sessionStarted) {
            pendingTogglesRef.current.push({ dateStr, toggleMode: mode })
            if (!sessionStarting.current && profileLoaded) {
                const startName = session?.user?.email
                    ? resolvedSignedInName
                    : (nameRef.current.trim() || null)
                startSession(startName)
            }
        }

        processDateToggle(dateStr)
    }, [mode, sessionStarted, startSession, processDateToggle, profileLoaded, session?.user?.email, resolvedSignedInName])

    // Auto-start session
    useEffect(() => {
        if (!event || sessionStarted || sessionStarting.current || !profileLoaded) return

        const timeoutId = setTimeout(() => {
            if (session?.user?.email) {
                startSession(resolvedSignedInName)
                return
            }
            if (readStoredToken(slug)) {
                startSession(null)
            }
        }, 0)

        return () => clearTimeout(timeoutId)
    }, [event, sessionStarted, slug, startSession, profileLoaded, session?.user?.email, resolvedSignedInName])

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
            action: 'save',
            responseToken: responseTokenRef.current,
            includes_so: includesSO,
            response_type: mode,
            dates: datesToConfirm.sort(),
            confirmed: true
        }

        if (trimmedName && !session?.user?.email) {
            updateData.name = trimmedName
        }

        try {
            await postRespond(slug, updateData)

            if (trimmedName && !session?.user?.email) {
                localStorage.setItem(NAME_STORAGE_KEY, trimmedName)
                setDisplayName(trimmedName)
            }

            setConfirmed(true)
            savedModeRef.current = mode
            if (event?.show_availability_counts) {
                const res = await fetch(`/api/respond/${slug}`)
                if (res.ok) {
                    const data = await res.json()
                    setConfirmedResponses(data.confirmedResponses || [])
                }
            }
        } catch {
            setError('Something went wrong. Please try again.')
        }

        setLoading(false)
    }

    const handleReset = () => {
        setResetSnapshot({
            availableDates: [...availableDates],
            unavailableDates: [...unavailableDates],
            hasMadeSelection,
            mode
        })

        if (saveTimeout.current) clearTimeout(saveTimeout.current)
        if (nameTimeout.current) clearTimeout(nameTimeout.current)
        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)

        savedModeRef.current = mode
        setAvailableDates([])
        setUnavailableDates([])
        availableDatesRef.current = []
        unavailableDatesRef.current = []
        setHasMadeSelection(false)
        setConfirmed(false)
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)
        setSaveStatus('idle')
        scheduleSave()
    }

    const handleUndoReset = () => {
        if (!resetSnapshot) return

        if (saveTimeout.current) clearTimeout(saveTimeout.current)
        if (nameTimeout.current) clearTimeout(nameTimeout.current)
        if (includesSOTimeout.current) clearTimeout(includesSOTimeout.current)

        savedModeRef.current = resetSnapshot.mode
        setMode(resetSnapshot.mode)
        setAvailableDates(resetSnapshot.availableDates)
        setUnavailableDates(resetSnapshot.unavailableDates)
        availableDatesRef.current = [...resetSnapshot.availableDates]
        unavailableDatesRef.current = [...resetSnapshot.unavailableDates]

        setHasMadeSelection(resetSnapshot.hasMadeSelection)
        setConfirmed(false)
        setShowEmptyConfirm(false)
        setEmptyConfirmChecked(false)
        setSaveStatus('idle')
        setResetSnapshot(null)
        scheduleSave()
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
    const hasUndoOption = !!resetSnapshot
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

    useEffect(() => {
        const loadHostingInfo = async () => {
            if (!confirmed || !event?.id || !responseId) {
                setHostingRoundInfo(null)
                return
            }

            setHostingInfoLoading(true)

            let data = null
            try {
                data = await postRespond(slug, {
                    action: 'hosting_info',
                    responseToken: responseTokenRef.current,
                })
            } catch {
                data = null
            }

            if (!data?.round || !data?.inviteToken) {
                setHostingRoundInfo(null)
                setHostingInfoLoading(false)
                return
            }

            const canUseLink = isAvailableOnDate(mode, mode === 'available' ? availableDates : unavailableDates, data.round.selected_date)

            setHostingRoundInfo({
                selectedDate: data.round.selected_date,
                inviteToken: data.inviteToken,
                canUseLink
            })
            setHostingInfoLoading(false)
        }

        loadHostingInfo()
    }, [confirmed, event?.id, responseId, mode, availableDates, unavailableDates, isAvailableOnDate, slug])

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
                        👥 Submitted for both you and your +1
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

                {hostingInfoLoading && (
                    <p style={{ color: '#94a3b8', marginTop: '0.9rem' }}>
                        Checking hosting follow-up status...
                    </p>
                )}

                {!hostingInfoLoading && hostingRoundInfo && (
                    <div style={{
                        marginTop: '1rem',
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '10px',
                        padding: '0.9rem'
                    }}>
                        <p style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>
                            A date was chosen for this event:
                            {' '}
                            <strong>
                                {new Date(hostingRoundInfo.selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric'
                                })}
                            </strong>
                        </p>

                        {hostingRoundInfo.canUseLink ? (
                            <Link
                                href={`/followup/${hostingRoundInfo.inviteToken}`}
                                className="nav-link"
                                style={{ display: 'inline-block', marginTop: '0.55rem' }}
                            >
                                🏠 Go To Hosting Form →
                            </Link>
                        ) : (
                            <p style={{ color: '#94a3b8', marginTop: '0.45rem', fontSize: '0.85rem' }}>
                                You are not currently marked available on that chosen date.
                            </p>
                        )}
                    </div>
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
                background: '#1e293b', borderRadius: '10px', padding: '0.65rem 1rem',
                marginBottom: '1.1rem', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '1rem'
            }}>
                <div>
                    <h1 style={{ marginBottom: '0.25rem', fontSize: '1.3rem' }}>📅 {event.title}</h1>
                    {event.description && (
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{event.description}</p>
                    )}
                </div>

                <div style={{ textAlign: 'center' }}>
                    {daysLeft !== null && (
                        <div style={{
                            background: daysLeft <= 2 ? '#7f1d1d' : '#1e3a2f',
                            border: daysLeft <= 2 ? '2px solid #ef4444' : '2px solid #10b981',
                            color: daysLeft <= 2 ? '#fca5a5' : '#a7f3d0',
                            padding: '0.3rem 0.75rem', borderRadius: '8px',
                            fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem'
                        }}>
                            {daysLeft === 0 ? '⏰ Due today!' : `⏰ ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}
                        </div>
                    )}
                    <div style={{
                        background: '#312e81', border: '2px solid #6366f1',
                        color: '#c7d2fe', padding: '0.3rem 0.75rem', borderRadius: '8px',
                        fontSize: '0.8rem', fontWeight: 600
                    }}>
                        👥 {availabilityTotal} responded
                    </div>

                </div>
            </div>

            {/* Name field — only shown when not signed in */}
            {!session?.user?.email && (
                <div style={{ marginBottom: '0.9rem' }}>
                    <input
                        type="text"
                        className="input-field"
                        placeholder="Your name (optional)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ marginBottom: 0 }}
                    />
                </div>

            )}

            <div style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '.9rem'
            }}>
                {event.allow_plus_one && (
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.55rem',
                        cursor: 'pointer',
                        padding: '0.42rem 0.85rem',
                        borderRadius: '10px',
                        background: '#1e293b',
                        border: '2px solid #334155',
                        flex: '1 1 260px',
                        minHeight: '42px'
                    }}>
                        <input
                            type="checkbox"
                            checked={includesSO}
                            onChange={(e) => setIncludesSO(e.target.checked)}
                            style={{
                                width: '16px',
                                height: '16px',
                                accentColor: '#6366f1',
                                cursor: 'pointer',
                                flexShrink: 0
                            }}
                        />
                        <span style={{ color: '#e2e8f0', fontSize: '0.9rem', lineHeight: 1.25 }}>
                            I&apos;m submitting for me and a +1
                        </span>
                    </label>
                )}

                <button
                    type="button"
                    onClick={handleModeChange}
                    aria-pressed={mode === 'unavailable'}
                    style={{
                        background: '#1e293b',
                        border: mode === 'available' ? '2px solid #10b981' : '2px solid #ef4444',
                        borderRadius: '10px',
                        padding: '0.42rem 0.85rem',
                        flex: '1 1 260px',
                        minHeight: '42px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        textAlign: 'left',
                        touchAction: 'manipulation'
                    }}
                >
                    <div>
                        <p style={{
                            color: '#e2e8f0',
                            fontSize: '0.85rem',
                            fontWeight: 600
                        }}>
                            Select days you are {mode === 'available' ? 'available' : 'not available'}
                        </p>
                    </div>

                    <span style={{
                        width: '46px',
                        height: '26px',
                        borderRadius: '999px',
                        background: mode === 'available' ? '#10b981' : '#ef4444',
                        position: 'relative',
                        transition: 'background 0.18s ease',
                        flexShrink: 0
                    }}>
                        <span style={{
                            position: 'absolute',
                            top: '3px',
                            left: mode === 'available' ? '23px' : '3px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: '#ffffff',
                            transition: 'left 0.18s ease',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
                        }} />
                    </span>
                </button>
                {(sessionStarted || hasUndoOption) && (
                    <button
                        onClick={hasUndoOption ? handleUndoReset : handleReset}
                        style={{
                            background: '#334155', color: '#94a3b8', border: 'none',
                            minHeight: '42px',
                            padding: '0.42rem 0.85rem',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        {hasUndoOption ? 'Undo' : 'Reset'}
                    </button>
                )}
            </div>

            {error && <p style={{ color: '#ef4444', margin: '0 0 1rem 0' }}>{error}</p>}

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
                    Dates show available/responded counts ({availabilityTotal} confirmed)
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
                saveStatus={saveStatus}
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
            {sessionStarted && !name.trim() && !session?.user?.email && (
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
