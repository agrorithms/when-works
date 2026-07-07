'use client'

import { useParams } from 'next/navigation'
import { useAdmin } from '../../layout'
import EventDetailPage from '../../../../components/EventDetailPage'

export default function AdminEventDetailPage() {
    const params = useParams()
    const admin = useAdmin()

    return (
        <EventDetailPage
            eventRef={typeof params?.id === 'string' ? params.id : ''}
            adminPassword={admin?.adminPassword || null}
            backHref="/admin/events"
            backLabel="← Back to Events"
        />
    )
}
