import { createClient } from '@supabase/supabase-js'

let supabaseAdmin = null

export function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRole) {
        return null
    }

    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })

    return supabaseAdmin
}
