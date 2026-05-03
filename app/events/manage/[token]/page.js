'use client'

import { useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import EventDetailPage from '../../../admin/events/[id]/page'

const SAVED_OWNER_TOKENS_KEY = 'when_works_saved_owner_tokens'

function readTokens() {
    if (typeof window === 'undefined') return []
    try {
        return JSON.parse(localStorage.getItem(SAVED_OWNER_TOKENS_KEY) || '[]')
    } catch {
        return []
    }
}

function writeTokens(tokens) {
    if (typeof window === 'undefined') return
    localStorage.setItem(SAVED_OWNER_TOKENS_KEY, JSON.stringify(tokens))
}

export default function OwnerLinkPage() {
    const params = useParams()
    const router = useRouter()
    const ref = typeof params?.token === 'string' ? params.token : ''

    useEffect(() => {
        if (!ref) {
            router.replace('/events')
        }
    }, [ref, router])

    const handleLoaded = useCallback((payload) => {
        const token = payload?.event?.ownership?.manage_token
        if (!token) return

        const nextTokens = readTokens()
        if (!nextTokens.includes(token)) {
            writeTokens([...nextTokens, token])
        }
    }, [])

    return (
        <EventDetailPage
            eventRef={ref}
            backHref="/events"
            backLabel="← Back to Events"
            onLoaded={handleLoaded}
        />
    )
}
