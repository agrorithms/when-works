'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const TIME_HELP = 'Use a time like 6pm, 6:30pm, 18:30, or 06:30.'
const CURATED_TIMEZONES = [
    { value: 'America/New_York', description: 'Eastern Time (US & Canada)' },
    { value: 'America/Chicago', description: 'Central Time (US & Canada)' },
    { value: 'America/Denver', description: 'Mountain Time (US & Canada)' },
    { value: 'America/Phoenix', description: 'Arizona' },
    { value: 'America/Los_Angeles', description: 'Pacific Time (US & Canada)' },
    { value: 'America/Anchorage', description: 'Alaska' },
    { value: 'Pacific/Honolulu', description: 'Hawaii' },
    { value: 'America/Toronto', description: 'Toronto' },
    { value: 'America/Vancouver', description: 'Vancouver' },
    { value: 'America/Mexico_City', description: 'Mexico City' },
    { value: 'America/Sao_Paulo', description: 'Sao Paulo' },
    { value: 'America/Buenos_Aires', description: 'Buenos Aires' },
    { value: 'Atlantic/Reykjavik', description: 'Reykjavik' },
    { value: 'Europe/London', description: 'London' },
    { value: 'Europe/Paris', description: 'Paris' },
    { value: 'Europe/Berlin', description: 'Berlin' },
    { value: 'Europe/Madrid', description: 'Madrid' },
    { value: 'Europe/Rome', description: 'Rome' },
    { value: 'Europe/Athens', description: 'Athens' },
    { value: 'Europe/Istanbul', description: 'Istanbul' },
    { value: 'Africa/Johannesburg', description: 'Johannesburg' },
    { value: 'Asia/Dubai', description: 'Dubai' },
    { value: 'Asia/Kolkata', description: 'India Standard Time' },
    { value: 'Asia/Bangkok', description: 'Bangkok' },
    { value: 'Asia/Singapore', description: 'Singapore' },
    { value: 'Asia/Hong_Kong', description: 'Hong Kong' },
    { value: 'Asia/Tokyo', description: 'Tokyo' },
    { value: 'Asia/Seoul', description: 'Seoul' },
    { value: 'Australia/Perth', description: 'Perth' },
    { value: 'Australia/Sydney', description: 'Sydney' },
    { value: 'Pacific/Auckland', description: 'Auckland' }
]

function normalizeTimeInput(value) {
    const raw = value.trim().toLowerCase()
    if (!raw) return null

    const compact = raw.replace(/\s+/g, '')

    const ampmMatch = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/)
    if (ampmMatch) {
        let hour = Number(ampmMatch[1])
        const minute = ampmMatch[2] ? Number(ampmMatch[2]) : 0
        const period = ampmMatch[3]

        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null

        if (period === 'am') {
            if (hour === 12) hour = 0
        } else if (hour !== 12) {
            hour += 12
        }

        return {
            dbTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
            normalizedDisplay: `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
        }
    }

    const twentyFourMatch = compact.match(/^(\d{1,2})(?::(\d{2}))$/)
    if (twentyFourMatch) {
        const hour = Number(twentyFourMatch[1])
        const minute = Number(twentyFourMatch[2])
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

        return {
            dbTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
            normalizedDisplay: `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
        }
    }

    return null
}

function getTimeZoneOffsetLabel(timeZone) {
    try {
        const now = new Date()
        const formatted = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(now)
        const tzPart = formatted.find(part => part.type === 'timeZoneName')?.value || 'UTC'
        return tzPart.replace('GMT', 'UTC')
    } catch {
        return 'UTC'
    }
}

export default function FollowUpRespondPage() {
    const params = useParams()
    const token = params.token

    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)

    const [invite, setInvite] = useState(null)
    const [round, setRound] = useState(null)
    const [event, setEvent] = useState(null)
    const [existingAnswer, setExistingAnswer] = useState(null)

    const [canHost, setCanHost] = useState(null)
    const [startTimeInput, setStartTimeInput] = useState('')
    const [responderTimezone, setResponderTimezone] = useState(() => {
        if (typeof window === 'undefined') return 'America/New_York'
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
    })
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const eventDateLabel = useMemo(() => {
        if (!round?.selected_date) return ''
        return new Date(round.selected_date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        })
    }, [round])

    const timezoneOptions = useMemo(() => {
        const mapped = CURATED_TIMEZONES.map((tz) => ({
            value: tz.value,
            label: `(${getTimeZoneOffsetLabel(tz.value)}) ${tz.description}`
        }))

        if (!responderTimezone) return mapped
        const hasDetected = mapped.some(tz => tz.value === responderTimezone)
        if (hasDetected) return mapped

        return [
            {
                value: responderTimezone,
                label: `(${getTimeZoneOffsetLabel(responderTimezone)}) Detected on your device`
            },
            ...mapped
        ]
    }, [responderTimezone])

    const isValidTimeZone = (tz) => {
        if (!tz || !tz.trim()) return false
        try {
            Intl.DateTimeFormat('en-US', { timeZone: tz.trim() })
            return true
        } catch {
            return false
        }
    }

    useEffect(() => {
        const fetchInvite = async () => {
            const { data, error: inviteError } = await supabase
                .from('event_followup_invites')
                .select(`
                    *,
                    event_followups (
                        *,
                        events (*)
                    )
                `)
                .eq('invite_token', token)
                .limit(1)

            if (inviteError || !data || data.length === 0) {
                setNotFound(true)
                setLoading(false)
                return
            }

            const row = data[0]
            const followup = row.event_followups

            if (!followup) {
                setNotFound(true)
                setLoading(false)
                return
            }

            const { data: answerData } = await supabase
                .from('event_followup_answers')
                .select('*')
                .eq('invite_id', row.id)
                .limit(1)

            const answer = answerData && answerData.length > 0 ? answerData[0] : null

            setInvite(row)
            setRound(followup)
            setEvent(followup.events)
            setExistingAnswer(answer)

            if (answer) {
                setCanHost(answer.still_available)
                setStartTimeInput(answer.preferred_start_time_text || (answer.preferred_start_time || '').slice(0, 5))
                setResponderTimezone(prev => answer.responder_timezone || prev)
            }

            setLoading(false)
        }

        fetchInvite()
    }, [token])

    const handleSubmit = async () => {
        setError('')
        setSuccess('')

        if (canHost === null) {
            setError('Please answer whether you can host this date.')
            return
        }

        if (canHost && !isValidTimeZone(responderTimezone)) {
            setError('Please enter a valid timezone (for example, America/New_York).')
            return
        }

        let normalizedTime = null
        if (canHost) {
            normalizedTime = normalizeTimeInput(startTimeInput)
            if (!normalizedTime) {
                setError('Please enter a valid start time. ' + TIME_HELP)
                return
            }
        }

        setSubmitting(true)

        const payload = {
            followup_id: round.id,
            invite_id: invite.id,
            still_available: canHost,
            preferred_start_time: canHost ? normalizedTime.dbTime : null,
            preferred_start_time_text: canHost ? normalizedTime.normalizedDisplay : null,
            responder_timezone: canHost ? responderTimezone.trim() : null
        }

        let saveError = null

        if (existingAnswer) {
            const { data: updated, error: updateError } = await supabase
                .from('event_followup_answers')
                .update(payload)
                .eq('id', existingAnswer.id)
                .select('*')
                .single()
            saveError = updateError
            if (!updateError) setExistingAnswer(updated)
        } else {
            const { data: inserted, error: insertError } = await supabase
                .from('event_followup_answers')
                .insert(payload)
                .select('*')
                .single()
            saveError = insertError
            if (!insertError) setExistingAnswer(inserted)
        }

        setSubmitting(false)

        if (saveError) {
            setError('Could not save your response. ' + saveError.message)
            return
        }

        setSuccess('Saved. You can revisit this same link anytime to update your answer.')
    }

    if (loading) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading follow-up...</h2>
            </div>
        )
    }

    if (notFound) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h1>😕</h1>
                <h1>Link Not Found</h1>
                <h2>This hosting link is invalid or has been removed.</h2>
                <Link href="/" className="nav-link" style={{ display: 'block', marginTop: '2rem' }}>
                    ← Back to Home
                </Link>
            </div>
        )
    }

    return (
        <div className="container" style={{ maxWidth: '700px' }}>
            <h1 style={{ marginTop: '1rem' }}>🏠 Hosting Follow-Up</h1>
            <h2 style={{ marginBottom: '0.75rem' }}>{event?.title}</h2>

            <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '1rem'
            }}>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                    Responding as <strong>{invite.invited_display_name}</strong>
                    {invite.invited_includes_so ? ' (+SO)' : ''}
                </p>
                <p style={{ color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Selected event date: <strong>{eventDateLabel}</strong>
                </p>
                <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    Round timezone: {round.timezone}
                </p>
            </div>

            <div className="person-card" style={{ marginBottom: '1rem' }}>
                <p style={{ color: '#e2e8f0', marginBottom: '0.6rem' }}>
                    Are you able to host on this date?
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        onClick={() => setCanHost(true)}
                        style={{
                            background: canHost === true ? '#065f46' : '#1e293b',
                            border: canHost === true ? '2px solid #10b981' : '2px solid #334155',
                            color: canHost === true ? '#a7f3d0' : '#cbd5e1',
                            borderRadius: '8px',
                            padding: '0.45rem 0.9rem',
                            cursor: 'pointer'
                        }}
                    >
                        Yes, I can host
                    </button>
                    <button
                        type="button"
                        onClick={() => setCanHost(false)}
                        style={{
                            background: canHost === false ? '#7f1d1d' : '#1e293b',
                            border: canHost === false ? '2px solid #ef4444' : '2px solid #334155',
                            color: canHost === false ? '#fecaca' : '#cbd5e1',
                            borderRadius: '8px',
                            padding: '0.45rem 0.9rem',
                            cursor: 'pointer'
                        }}
                    >
                        No, I cannot host
                    </button>
                </div>
            </div>

            {canHost && (
                <>
                    <div className="person-card" style={{ marginBottom: '1rem' }}>
                        <p style={{ color: '#e2e8f0', marginBottom: '0.55rem' }}>
                            What start time works for you if you are hosting?
                        </p>
                        <input
                            type="text"
                            className="input-field"
                            value={startTimeInput}
                            onChange={(e) => setStartTimeInput(e.target.value)}
                            placeholder="e.g. 6pm or 6:30pm or 18:30"
                            style={{ marginBottom: '0.45rem' }}
                        />
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{TIME_HELP}</p>
                    </div>

                    <div className="person-card" style={{ marginBottom: '1rem' }}>
                        <p style={{ color: '#e2e8f0', marginBottom: '0.55rem' }}>
                            Your timezone for this response
                        </p>
                        <select
                            className="input-field"
                            value={responderTimezone}
                            onChange={(e) => setResponderTimezone(e.target.value)}
                            style={{ marginBottom: '0.4rem' }}
                        >
                            {timezoneOptions.map(tz => (
                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                            ))}
                        </select>
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                            Auto-detected from your device. You can change it here.
                        </p>
                    </div>
                </>
            )}

            {error && <p style={{ color: '#f87171', marginBottom: '0.7rem' }}>{error}</p>}
            {success && <p style={{ color: '#34d399', marginBottom: '0.7rem' }}>{success}</p>}

            <button
                className="submit-btn"
                onClick={handleSubmit}
                disabled={submitting}
            >
                {submitting ? 'Saving...' : 'Save Hosting Response'}
            </button>

            <p style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.8rem', textAlign: 'center' }}>
                Reopening this same link will let you update your response.
            </p>
        </div>
    )
}
