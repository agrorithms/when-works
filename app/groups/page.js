'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { readGroupTokens, saveGroupToken } from '../../lib/savedGroupTokens'
import { CADENCE_CHOICES, cadenceFromChoice, describeCadence } from '../../lib/schedule'

const PARTICIPANT_TOKEN_KEY = 'when_works_participant_token'

function cadenceLabel(group) {
    return describeCadence(group) || 'No set cadence'
}

function GroupCard({ group, subtitle }) {
    return (
        <Link href={group.manageLink} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="person-card" style={{ cursor: 'pointer', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <h3 style={{ marginBottom: '0.25rem' }}>👥 {group.name}</h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{cadenceLabel(group)}</p>
                        {subtitle && (
                            <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.3rem' }}>{subtitle}</p>
                        )}
                    </div>
                    {group.memberCount !== undefined && (
                        <div style={{ background: '#1e3a2f', padding: '0.35rem 0.6rem', borderRadius: '999px', color: '#a7f3d0', fontSize: '0.8rem', alignSelf: 'flex-start' }}>
                            {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                        </div>
                    )}
                </div>
            </div>
        </Link>
    )
}

export default function GroupsPage() {
    const router = useRouter()
    const { data: session, status } = useSession()
    const signedIn = status === 'authenticated'

    const [ownedGroups, setOwnedGroups] = useState([])
    const [savedGroups, setSavedGroups] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const [newName, setNewName] = useState('')
    const [newCadence, setNewCadence] = useState('')
    const [newAnchorDay, setNewAnchorDay] = useState('15')
    const [createLoading, setCreateLoading] = useState(false)
    const [createError, setCreateError] = useState('')

    const loadGroups = useCallback(async () => {
        setLoading(true)
        setError('')

        try {
            const tokens = readGroupTokens()

            const tokenRequests = tokens.map(async (token) => {
                const res = await fetch(`/api/groups/manage/${token}`)
                if (!res.ok) return null
                const data = await res.json()
                if (!data?.group) return null
                return { ...data.group, memberCount: (data.members || []).length }
            })

            const [ownedResponse, tokenResults] = await Promise.all([
                signedIn ? fetch('/api/groups') : Promise.resolve(null),
                Promise.all(tokenRequests),
            ])

            if (ownedResponse && !ownedResponse.ok) {
                throw new Error('Failed to load your groups.')
            }

            const ownedPayload = ownedResponse ? await ownedResponse.json() : { groups: [] }
            const owned = ownedPayload.groups || []
            const ownedIds = new Set(owned.map((group) => group.id))

            setOwnedGroups(owned)
            setSavedGroups(tokenResults.filter(Boolean).filter((group) => !ownedIds.has(group.id)))
        } catch (loadError) {
            setError(loadError.message || 'Failed to load groups.')
        } finally {
            setLoading(false)
        }
    }, [signedIn])

    useEffect(() => {
        if (status === 'loading') return
        const timeoutId = setTimeout(loadGroups, 0)
        return () => clearTimeout(timeoutId)
    }, [loadGroups, status])

    const createGroup = async () => {
        if (!newName.trim()) {
            setCreateError('Please enter a group name.')
            return
        }

        setCreateLoading(true)
        setCreateError('')

        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName.trim(),
                    cadence: cadenceFromChoice(newCadence, Number(newAnchorDay)),
                    access_mode: signedIn ? 'google' : 'link',
                    participantToken: typeof window !== 'undefined'
                        ? localStorage.getItem(PARTICIPANT_TOKEN_KEY) || null
                        : null,
                }),
            })

            const payload = await res.json().catch(() => ({}))

            if (!res.ok) {
                setCreateError(payload.error || 'Something went wrong.')
                return
            }

            const manageLink = payload.group?.manageLink
            if (manageLink && payload.group.access_mode === 'link') {
                saveGroupToken(manageLink.split('/').pop())
            }
            router.push(manageLink || '/groups')
        } catch {
            setCreateError('Something went wrong. Please try again.')
        } finally {
            setCreateLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="container" style={{ paddingTop: '3rem', textAlign: 'center' }}>
                <h2>Loading your groups...</h2>
            </div>
        )
    }

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a' }}>
            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
                <Link href="/" className="nav-link">
                    ← Home
                </Link>
                <h1 style={{ marginTop: '0.75rem' }}>My Groups</h1>
                <p style={{ color: '#94a3b8', marginTop: '0.3rem' }}>
                    Keep a crew together: track who shows up, and spin up the next hangout in one tap.
                </p>

                {signedIn && (
                    <p style={{ color: '#cbd5e1', marginTop: '0.8rem' }}>
                        Signed in as <strong>{session?.user?.email}</strong>
                    </p>
                )}

                {error && (
                    <div className="section-card" style={{ marginTop: '1rem', borderColor: '#ef4444' }}>
                        <p style={{ color: '#fca5a5' }}>{error}</p>
                    </div>
                )}

                <div className="section-card" style={{ marginTop: '1.25rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Create a group</h2>
                    <p style={{ color: '#94a3b8', marginBottom: '0.9rem' }}>
                        {signedIn
                            ? 'This group will be owned by your Google account.'
                            : 'A private manage link will be generated and saved to this browser.'}
                    </p>

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        Group name *
                    </label>
                    <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. Trivia Crew, Sunday Dinner Club..."
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                    />

                    <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                        How often do you want to hang out?
                    </label>
                    <select
                        className="input-field"
                        value={newCadence}
                        onChange={(e) => setNewCadence(e.target.value)}
                    >
                        <option value="">No set cadence</option>
                        {CADENCE_CHOICES.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>

                    {newCadence.startsWith('month') && (
                        <>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                Around which day of the month?
                            </label>
                            <select
                                className="input-field"
                                value={newAnchorDay}
                                onChange={(e) => setNewAnchorDay(e.target.value)}
                            >
                                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                                    <option key={day} value={String(day)}>{day}</option>
                                ))}
                            </select>
                        </>
                    )}

                    {createError && (
                        <p style={{ color: '#fca5a5', marginBottom: '0.75rem' }}>{createError}</p>
                    )}

                    <button className="submit-btn" onClick={createGroup} disabled={createLoading}>
                        {createLoading ? 'Creating...' : 'Create group'}
                    </button>
                </div>

                <div className="section-card" style={{ marginTop: '1rem' }}>
                    <h2 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Your groups</h2>
                    <p style={{ color: '#94a3b8' }}>
                        Groups you own with Google sign-in, plus manage links saved on this browser.
                    </p>

                    {ownedGroups.length === 0 && savedGroups.length === 0 ? (
                        <div className="no-responses" style={{ padding: '1.4rem 0 0.5rem' }}>
                            <p>{signedIn ? 'No groups yet — create your first one above.' : 'No groups on this browser yet. Create one above, or sign in with Google to see groups you own.'}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                            {ownedGroups.map((group) => (
                                <GroupCard key={group.id} group={group} subtitle="Owned by you" />
                            ))}
                            {savedGroups.map((group) => (
                                <GroupCard key={group.id} group={group} subtitle="Saved manage link" />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
