'use client'

import { useState, createContext, useContext } from 'react'

const AdminContext = createContext(null)

export function useAdmin() {
    return useContext(AdminContext)
}

const ADMIN_PASSWORD_STORAGE_KEY = 'admin_password'

export default function AdminLayout({ children }) {
    const [adminPassword, setAdminPassword] = useState(() => {
        if (typeof window === 'undefined') return null
        return sessionStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY) || null
    })
    const [password, setPassword] = useState('')
    const [authError, setAuthError] = useState('')
    const [checking, setChecking] = useState(false)

    const handleLogin = async () => {
        if (!password || checking) return
        setChecking(true)
        setAuthError('')

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            })

            if (res.ok) {
                sessionStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password)
                setAdminPassword(password)
            } else {
                setAuthError('Wrong password.')
            }
        } catch {
            setAuthError('Could not verify the password. Try again.')
        }

        setChecking(false)
    }

    if (!adminPassword) {
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
                <button className="submit-btn" onClick={handleLogin} disabled={checking}>
                    {checking ? 'Checking...' : 'Enter'}
                </button>
            </div>
        )
    }

    return (
        <AdminContext.Provider value={{ authenticated: true, adminPassword }}>
            {children}
        </AdminContext.Provider>
    )
}
