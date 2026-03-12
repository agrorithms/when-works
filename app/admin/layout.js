'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import Link from 'next/link'

const AdminContext = createContext(null)

export function useAdmin() {
    return useContext(AdminContext)
}

export default function AdminLayout({ children }) {
    const [authenticated, setAuthenticated] = useState(false)
    const [checking, setChecking] = useState(true)
    const [password, setPassword] = useState('')
    const [authError, setAuthError] = useState('')

    const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'changeme'

    useEffect(() => {
        const stored = sessionStorage.getItem('admin_auth')
        if (stored === 'true') {
            setAuthenticated(true)
        }
        setChecking(false)
    }, [])

    const handleLogin = () => {
        if (password === ADMIN_PASSWORD) {
            setAuthenticated(true)
            sessionStorage.setItem('admin_auth', 'true')
            setAuthError('')
        } else {
            setAuthError('Wrong password.')
        }
    }

    if (checking) {
        return (
            <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
                <h2>Loading...</h2>
            </div>
        )
    }

    if (!authenticated) {
        return (
            <div className="container" style={{ paddingTop: '4rem' }}>
                <h1>👑 Admin Dashboard</h1>
                <h2>Enter the admin password</h2>
                <input
                    type="password"
                    className="input-field"
                    placeholder="Password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                {authError && <p style={{ color: '#ef4444', margin: '0.5rem 0' }}>{authError}</p>}
                <button className="submit-btn" onClick={handleLogin}>Enter</button>
            </div>
        )
    }

    return (
        <AdminContext.Provider value={{ authenticated }}>
            {children}
        </AdminContext.Provider>
    )
}
