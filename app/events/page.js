'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import { supabase } from '../../lib/supabase'

const SAVED_INVITES_KEY = 'when_works_saved_invites'
const SAVED_OWNER_TOKENS_KEY = 'when_works_saved_owner_tokens'

function readStorageArray(key) {
    if (typeof window === 'undefined') return []
    try {
        return JSON.parse(localStorage.getItem(key) || '[]')
    } catch {
        return []
    }
}

function writeStorageArray(key, value) {
    if (typeof window === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
}

function formatRange(event) {
    if (!event?.date_range_start || !event?.date_range_end) return ''
    const start = new Date(event.date_range_start + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })
    const end = new Date(event.date_range_end + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
    return `${start} → ${end}`
}

function EventCard({ event, href, subtitle, onRemove, removeLabel = 'Remove' }) {
    return (
        <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="person-card" style={{ cursor: 'pointer', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: '220px' }}>
                        <h3 style={{ marginBottom: '0.25rem' }}>📅 {event.title}</h3>
                        {event.description && (
                            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                                {event.description}
                            </p>
                        )}
                        <p style={{ color: '#64748b', fontSize: '0.82rem' }}>{formatRange(event)}</p>
                        {subtitle && (
                            <p style={{ color: '#cbd5e1', fontSize: '0.82rem', marginTop: '0.45rem' }}>{subtitle}</p>
                        )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                        <div style={{ background: '#1e3a2f', padding: '0.35rem 0.6rem', borderRadius: '999px', color: '#a7f3d0', fontSize: '0.8rem' }}>
                            {event.confirmedCount ?? 0} confirmed
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.45rem' }}>
                            {event.responseCount ?? 0} responses
                        </div>
                    </div>
                </div>

                {onRemove && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="button-secondary"
                        style={{ marginTop: '0.85rem' }}
                    >
                        {removeLabel}
                    </button>
                )}
            </div>
        </Link>
    )
}

export default function EventsDashboardPage() {
    const { data: session, status } = useSession()
    const [createdEvents, setCreatedEvents] = useState([])
    const [savedInviteEvents, setSavedInviteEvents] = useState([])
    const [savedOwnerEvents, setSavedOwnerEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const signedIn = status === 'authenticated'
    const emailLabel = session?.user?.email || ''

    const loadDashboard = useCallback(async () => {
        setLoading(true)
        setError('')

        try {
            const nextSavedInvites = readStorageArray(SAVED_INVITES_KEY)
            const nextSavedOwnerTokens = readStorageArray(SAVED_OWNER_TOKENS_KEY)

            const inviteRequests = nextSavedInvites.map(async (slug) => {
                const { data } = await supabase
                    .from('events')
                    .select('*')
                    .eq('slug', slug)
                    .limit(1)

                if (!data || data.length === 0) return null

                const event = data[0]
                const { data: responses } = await supabase
                    .from('responses')
                    .select('id, confirmed')
                    .eq('event_id', event.id)

                return {
                    ...event,
                    responseCount: responses?.length || 0,
                    confirmedCount: responses?.filter((response) => response.confirmed).length || 0,
                }
            })

            const ownerRequests = nextSavedOwnerTokens.map(async (token) => {
                const response = await fetch(`/api/events/manage/${token}`)
                if (!response.ok) return null
                const data = await response.json()
                return data.event
            })

            const [createdResponse, inviteResults, ownerResults] = await Promise.all([
                signedIn ? fetch('/api/events') : Promise.resolve(null),
                Promise.all(inviteRequests),
                Promise.all(ownerRequests),
            ])

            if (createdResponse && !createdResponse.ok) {
                throw new Error('Failed to load your created events.')
            }

            const createdPayload = createdResponse ? await createdResponse.json() : { events: [] }
            setCreatedEvents(createdPayload.events || [])
            setSavedInviteEvents(inviteResults.filter(Boolean))
            setSavedOwnerEvents(ownerResults.filter(Boolean))
        } catch (loadError) {
            setError(loadError.message || 'Failed to load dashboard.')
        } finally {
            setLoading(false)
        }
    }, [signedIn])

    useEffect(() => {
        const timeoutId = setTimeout(loadDashboard, 0)
        return () => clearTimeout(timeoutId)
    }, [loadDashboard])

    const createdEmptyState = useMemo(() => {
        if (signedIn) {
            return 'No created events yet. Start a new one and it will appear here.'
        }
        return 'Sign in with Google to see events you created.'
    }, [signedIn])

    const removeSavedInvite = (slug) => {
        const next = readStorageArray(SAVED_INVITES_KEY).filter((item) => item !== slug)
        writeStorageArray(SAVED_INVITES_KEY, next)
        setSavedInviteEvents((current) => current.filter((event) => event.slug !== slug))
    }

    const removeSavedOwnerEvent = (token) => {
        const next = readStorageArray(SAVED_OWNER_TOKENS_KEY).filter((item) => item !== token)
        writeStorageArray(SAVED_OWNER_TOKENS_KEY, next)
        setSavedOwnerEvents((current) => current.filter((event) => event.ownership?.manage_token !== token))
    }

    if (loading) {
        return (
            <div className="container" style={{ paddingTop: '3rem', textAlign: 'center' }}>
                <h2>Loading your dashboard...</h2>
            </div>
        )
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'radial-gradient(circle at top left, rgba(16, 185, 129, 0.16), transparent 22%), #0f172a',
            }}
        >
            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                        <Link href="/" className="nav-link">
                            ← Home
                        </Link>
                        <h1 style={{ marginTop: '0.75rem' }}>Your events</h1>
                        <p style={{ color: '#94a3b8', marginTop: '0.3rem' }}>
                            Created events, guest owner links, and saved invite links on this browser.
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <Link href="/events/new" className="button-primary">
                            Create event
                        </Link>
                        {signedIn ? (
                            <button onClick={() => signOut({ callbackUrl: '/' })} className="button-secondary">
                                Sign out
                            </button>
                        ) : (
                            <button onClick={() => signIn('google', { callbackUrl: '/events' })} className="button-secondary">
                                Sign in with Google
                            </button>
                        )}
                    </div>
                </div>

                {signedIn && (
                    <p style={{ color: '#cbd5e1', marginTop: '0.8rem' }}>
                        Signed in as <strong>{emailLabel}</strong>
                    </p>
                )}

                {error && (
                    <div className="section-card" style={{ marginTop: '1rem', borderColor: '#ef4444' }}>
                        <p style={{ color: '#fca5a5' }}>{error}</p>
                    </div>
                )}

                <div className="section-card" style={{ marginTop: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <div>
                            <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Created by you</h2>
                            <p style={{ color: '#94a3b8' }}>
                                Events you created with Google sign-in or claimed with a matching email.
                            </p>
                        </div>
                    </div>

                    {createdEvents.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1.8rem 0 0.5rem' }}>
                            <p>{createdEmptyState}</p>
                            <Link href="/events/new" className="nav-link" style={{ display: 'inline-block', marginTop: '1rem' }}>
                                ➕ Create your first event
                            </Link>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                            {createdEvents.map((event) => (
                                <EventCard
                                    key={event.id}
                                    event={event}
                                    href={event.manageLink || `/events/manage/${event.id}`}
                                    subtitle={event.ownership?.access_mode === 'link' ? 'Saved owner link available' : 'Owned by you'}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="section-card" style={{ marginTop: '1rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Saved invite links</h2>
                    <p style={{ color: '#94a3b8' }}>
                        Public invite links you’ve opened on this browser are saved here for quick access.
                    </p>

                    {savedInviteEvents.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1.4rem 0 0.5rem' }}>
                            <p>No saved invite links on this browser yet.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                            {savedInviteEvents.map((event) => (
                                <EventCard
                                    key={event.id}
                                    event={event}
                                    href={`/respond/${event.slug}`}
                                    subtitle="Saved from a public invite link"
                                    onRemove={() => removeSavedInvite(event.slug)}
                                    removeLabel="Remove saved link"
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="section-card" style={{ marginTop: '1rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Saved owner links</h2>
                    <p style={{ color: '#94a3b8' }}>
                        Guest owner links you opened on this browser are saved here so you can return later.
                    </p>

                    {savedOwnerEvents.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1.4rem 0 0.5rem' }}>
                            <p>No saved owner links on this browser yet.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                            {savedOwnerEvents.map((event) => (
                                <EventCard
                                    key={event.id}
                                    event={event}
                                    href={`/events/manage/${event.ownership.manage_token}`}
                                    subtitle="Private owner link"
                                    onRemove={() => removeSavedOwnerEvent(event.ownership.manage_token)}
                                    removeLabel="Remove saved owner link"
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
