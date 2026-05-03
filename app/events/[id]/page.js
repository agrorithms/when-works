'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function EventOwnerPage() {
    const params = useParams()
    const router = useRouter()
    const eventId = typeof params?.id === 'string' ? params.id : ''

    useEffect(() => {
        if (!eventId) {
            router.replace('/events')
            return
        }

        router.replace(`/events/manage/${eventId}`)
    }, [eventId, router])

    return (
        <div className="container" style={{ paddingTop: '3rem', textAlign: 'center' }}>
            <h2>Loading event...</h2>
        </div>
    )
}
