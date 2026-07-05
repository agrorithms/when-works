'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ProfilePage() {
    const { data: session, status } = useSession()
    const router = useRouter()
    const [profile, setProfile] = useState(null)

    useEffect(() => {
        if (status === 'unauthenticated') router.replace('/')
    }, [status, router])

    useEffect(() => {
        if (status !== 'authenticated') return
        fetch('/api/profile')
            .then(r => r.json())
            .then(data => setProfile(data))
    }, [status])

    if (status === 'loading' || (status === 'authenticated' && !profile)) {
        return <div className="container"><p style={{ color: '#64748b' }}>Loading…</p></div>
    }

    if (status === 'unauthenticated' || !profile) return null

    const effectiveName = profile.display_name || session.user.name

    return (
        <div className="container">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h1>Profile</h1>
                <Link href="/settings" style={{ color: '#6366f1', fontSize: '0.85rem', textDecoration: 'none' }}>
                    Edit in Settings →
                </Link>
            </div>
            <p style={{ color: '#64748b', marginBottom: '2rem', fontSize: '0.9rem' }}>
                Signed in as {effectiveName}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '480px' }}>
                <div>
                    <label style={labelStyle}>Email</label>
                    <p style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>{profile.email}</p>
                </div>
                <div>
                    <label style={labelStyle}>Display Name</label>
                    <p style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>{effectiveName}</p>
                </div>
                <div>
                    <label style={labelStyle}>Default Timezone</label>
                    <p style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>
                        {profile.default_timezone ?? <span style={{ color: '#64748b' }}>Not set</span>}
                    </p>
                </div>
            </div>
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
