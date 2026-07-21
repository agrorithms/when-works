import GoogleProviderModule from "next-auth/providers/google"
import { getSupabaseAdmin } from './supabaseAdmin'

const GoogleProvider =
  GoogleProviderModule?.default?.default ||
  GoogleProviderModule?.default ||
  GoogleProviderModule

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (user?.email) {
        try {
          const supabaseAdmin = getSupabaseAdmin()
          if (supabaseAdmin) {
            // Prefs columns are never included here, so existing values
            // survive the upsert. The refresh token (prompt=consent mints a
            // fresh one every sign-in) is stored server-side so the daily
            // cron can create calendar events for auto-scheduled group
            // polls; omitted when absent so a stored token is never nulled.
            const row = {
              google_user_id: profile?.sub ?? null,
              email: user.email.trim().toLowerCase(),
            }
            if (account?.refresh_token) {
              row.google_refresh_token = account.refresh_token
              row.google_refresh_token_granted_at = new Date().toISOString()
            }
            await supabaseAdmin
              .from('participants')
              .upsert(row, { onConflict: 'email', ignoreDuplicates: false })
          }
        } catch {
          // Don't block sign-in on participant upsert failure
        }
      }
      return true
    },
    async jwt({ token, account, user }) {
      // Initial sign-in: capture Google tokens
      if (account) {
        return {
          ...token,
          id: user.id,
          email: user.email,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token,
          googleAccessTokenExpires: account.expires_at * 1000,
        }
      }

      // Token still valid
      if (Date.now() < (token.googleAccessTokenExpires ?? 0)) return token

      // No refresh token available
      if (!token.googleRefreshToken) return token

      // Refresh the access token
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: token.googleRefreshToken,
          }),
        })
        const refreshed = await res.json()
        if (!res.ok) throw refreshed
        return {
          ...token,
          googleAccessToken: refreshed.access_token,
          googleAccessTokenExpires: Date.now() + refreshed.expires_in * 1000,
        }
      } catch {
        return { ...token, googleAccessToken: null }
      }
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token?.id || null
      }
      session.accessToken = token.googleAccessToken ?? null
      return session
    },
  },
}
