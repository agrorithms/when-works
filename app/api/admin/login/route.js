import { isValidAdminPassword } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request) {
    const body = await request.json().catch(() => ({}))

    if (!isValidAdminPassword(body.password)) {
        return Response.json({ error: 'Wrong password.' }, { status: 401 })
    }

    return Response.json({ ok: true })
}
