'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

const TIMEZONES_FALLBACK = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'UTC',
]

const DATE_FORMAT_OPTIONS = [
    { value: 'us', label: 'MM/DD/YYYY' },
    { value: 'eu', label: 'DD/MM/YYYY' },
    { value: 'iso', label: 'YYYY-MM-DD' },
]

const TIME_FORMAT_OPTIONS = [
    { value: 'auto', label: 'Auto (use device locale)' },
    { value: '12h', label: '12-hour (3:30 PM)' },
    { value: '24h', label: '24-hour (15:30)' },
]

function formatDateExample(formatValue) {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    if (formatValue === 'eu') return `${day}/${m}/${y}`
    if (formatValue === 'iso') return `${y}-${m}-${day}`
    return `${m}/${day}/${y}`
}

export default function SettingsPage() {
    const { data: session, status } = useSession()
    const router = useRouter()

    const [profile, setProfile] = useState(null)
    const [nameInput, setNameInput] = useState('')
    const [nameDirty, setNameDirty] = useState(false)
    const [saveStatus, setSaveStatus] = useState('idle')
    const [deleteModal, setDeleteModal] = useState(false)
    const [deleteScope, setDeleteScope] = useState('profile')
    const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [exportLoading, setExportLoading] = useState(false)

    const [timezones] = useState(() => {
        try { return Intl.supportedValuesOf('timeZone') } catch { return TIMEZONES_FALLBACK }
    })

    const savedTimer = useRef(null)

    useEffect(() => {
        if (status === 'unauthenticated') router.replace('/')
    }, [status, router])

    useEffect(() => {
        if (status !== 'authenticated') return
        fetch('/api/settings')
            .then(r => r.json())
            .then(data => {
                setProfile(data)
                setNameInput(data.display_name ?? '')
                if (!data.default_timezone) {
                    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
                    patch({ default_timezone: browserTz }).then(() => {
                        setProfile(prev => ({ ...prev, default_timezone: browserTz }))
                    })
                }
            })
    }, [status])

    function showSaved() {
        setSaveStatus('saved')
        clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000)
    }

    async function patch(updates) {
        return fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
    }

    async function saveName() {
        if (!nameDirty) return
        setSaveStatus('saving')
        await patch({ display_name: nameInput })
        setProfile(prev => ({ ...prev, display_name: nameInput.trim() || null }))
        setNameDirty(false)
        showSaved()
    }

    async function savePref(key, value) {
        setSaveStatus('saving')
        await patch({ [key]: value })
        setProfile(prev => ({ ...prev, [key]: value }))
        showSaved()
    }

    async function handleExport() {
        setExportLoading(true)
        try {
            const res = await fetch('/api/settings/export')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const date = new Date().toISOString().slice(0, 10)
            a.download = `when-works-data-${date}.json`
            a.click()
            URL.revokeObjectURL(url)
        } finally {
            setExportLoading(false)
        }
    }

    async function handleDelete() {
        if (normalizeEmail(deleteConfirmEmail) !== normalizeEmail(session.user.email)) return
        setDeleteLoading(true)
        const res = await fetch('/api/settings/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: deleteScope, confirmEmail: deleteConfirmEmail }),
        })
        if (res.ok) {
            signOut({ callbackUrl: '/' })
        } else {
            setDeleteLoading(false)
            alert('Something went wrong. Please try again.')
        }
    }

    function normalizeEmail(email) {
        return email ? email.trim().toLowerCase() : ''
    }

    const deleteEmailMatch = normalizeEmail(deleteConfirmEmail) === normalizeEmail(session?.user?.email)

    if (status === 'loading' || (status === 'authenticated' && !profile)) {
        return <div className="container"><p style={{ color: '#64748b' }}>Loading…</p></div>
    }

    if (status === 'unauthenticated' || !profile) return null

    return (
        <div className="container">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h1>Settings</h1>
                <span style={{
                    fontSize: '0.82rem',
                    color: saveStatus === 'saved' ? '#10b981' : '#64748b',
                    transition: 'color 0.2s ease',
                    minWidth: '60px',
                    textAlign: 'right',
                }}>
                    {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
                </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: '480px', marginTop: '1.5rem' }}>

                {/* Account */}
                <section>
                    <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: '1rem' }}>
                        Account
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <label style={labelStyle}>Email</label>
                            <p style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>{profile.email}</p>
                        </div>
                        <div>
                            <label style={labelStyle}>Display Name</label>
                            <p style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                                Overrides your Google name. Leave blank to use Google name ({session.user.name}).
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    className="input-field"
                                    style={{ marginBottom: 0, flex: 1 }}
                                    type="text"
                                    placeholder={session.user.name}
                                    value={nameInput}
                                    onChange={e => { setNameInput(e.target.value); setNameDirty(true) }}
                                    onKeyDown={e => { if (e.key === 'Enter') saveName() }}
                                    maxLength={80}
                                />
                                <button
                                    className="button-primary"
                                    onClick={saveName}
                                    disabled={!nameDirty}
                                    style={{ whiteSpace: 'nowrap' }}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Preferences */}
                <section>
                    <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: '1rem' }}>
                        Preferences
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <label style={labelStyle}>Default Timezone</label>
                            <select
                                className="input-field"
                                style={{ marginBottom: 0 }}
                                value={profile.default_timezone ?? ''}
                                onChange={e => savePref('default_timezone', e.target.value)}
                            >
                                {!profile.default_timezone && <option value="">Select timezone…</option>}
                                {timezones.map(tz => (
                                    <option key={tz} value={tz}>{tz}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Date Format</label>
                            <select
                                className="input-field"
                                style={{ marginBottom: 0 }}
                                value={profile.date_format ?? 'us'}
                                onChange={e => savePref('date_format', e.target.value)}
                            >
                                {DATE_FORMAT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label} — e.g. {formatDateExample(opt.value)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Time Format</label>
                            <select
                                className="input-field"
                                style={{ marginBottom: 0 }}
                                value={profile.time_format ?? 'auto'}
                                onChange={e => savePref('time_format', e.target.value)}
                            >
                                {TIME_FORMAT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </section>

                {/* Your Data */}
                <section>
                    <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: '1rem' }}>
                        Your Data
                    </h2>
                    <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        Download a JSON file containing your profile, events you created, and your responses.
                    </p>
                    <button
                        className="button-primary"
                        onClick={handleExport}
                        disabled={exportLoading}
                    >
                        {exportLoading ? 'Preparing…' : 'Download my data'}
                    </button>
                </section>

                {/* Delete Account */}
                <section style={{ borderTop: '1px solid #1e293b', paddingTop: '2rem' }}>
                    <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569', marginBottom: '0.5rem' }}>
                        Delete Account
                    </h2>
                    <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        Permanently remove your account. This cannot be undone.
                    </p>
                    <button
                        onClick={() => setDeleteModal(true)}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: '#64748b',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                        }}
                    >
                        Delete account…
                    </button>
                </section>

            </div>

            {/* Delete confirmation modal */}
            {deleteModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, padding: '1rem',
                }}>
                    <div style={{
                        background: '#1e293b', borderRadius: '8px', padding: '1.5rem',
                        maxWidth: '440px', width: '100%',
                    }}>
                        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
                            Delete Account
                        </h2>

                        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                            Choose what to delete:
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="deleteScope"
                                    value="profile"
                                    checked={deleteScope === 'profile'}
                                    onChange={() => setDeleteScope('profile')}
                                    style={{ marginTop: '2px', accentColor: '#6366f1' }}
                                />
                                <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>
                                    <strong>Profile only</strong> — your events and responses remain but are no longer linked to your account.
                                </span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="deleteScope"
                                    value="all"
                                    checked={deleteScope === 'all'}
                                    onChange={() => setDeleteScope('all')}
                                    style={{ marginTop: '2px', accentColor: '#6366f1' }}
                                />
                                <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>
                                    <strong>Everything</strong> — profile, events you created, and all your responses are permanently deleted.
                                </span>
                            </label>
                        </div>

                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                            Type your email to confirm: <strong style={{ color: '#cbd5e1' }}>{profile.email}</strong>
                        </label>
                        <input
                            className="input-field"
                            type="email"
                            placeholder={profile.email}
                            value={deleteConfirmEmail}
                            onChange={e => setDeleteConfirmEmail(e.target.value)}
                            style={{ marginBottom: '1.25rem' }}
                        />

                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => { setDeleteModal(false); setDeleteConfirmEmail('') }}
                                style={{
                                    background: 'none', border: '1px solid #334155', borderRadius: '6px',
                                    padding: '0.45rem 1rem', color: '#94a3b8', cursor: 'pointer', fontSize: '0.875rem',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={!deleteEmailMatch || deleteLoading}
                                style={{
                                    background: deleteEmailMatch ? '#7f1d1d' : '#1e293b',
                                    border: '1px solid ' + (deleteEmailMatch ? '#991b1b' : '#334155'),
                                    borderRadius: '6px', padding: '0.45rem 1rem',
                                    color: deleteEmailMatch ? '#fca5a5' : '#475569',
                                    cursor: deleteEmailMatch ? 'pointer' : 'not-allowed',
                                    fontSize: '0.875rem',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {deleteLoading ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

const labelStyle = {
    display: 'block',
    color: '#94a3b8',
    fontSize: '0.8rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.4rem',
}
