'use client'

import { useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import EventDetailPage from '../../../admin/events/[id]/page'
import { saveOwnerToken } from '../../../../lib/savedOwnerTokens'

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
        saveOwnerToken(token)
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
