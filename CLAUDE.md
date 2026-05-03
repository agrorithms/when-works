# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**When Works** is a Next.js event scheduling application that helps groups find the best date to hang out. Users create events with date ranges, share a public link, and collect availability from respondents without requiring sign-ups. The app supports three creator access methods (Google sign-in, email claim, or private owner link) and features an admin dashboard for event management.

### Tech Stack

- **Framework**: Next.js 16.2 (App Router, server/client components)
- **Database**: Supabase (PostgreSQL with RLS)
- **Auth**: next-auth 4.24 with Google OAuth
- **Frontend**: React 19 with vanilla CSS (Tailwind color palette, dark theme)
- **Styling**: Custom CSS with no build tools (colors from Tailwind, inline styles for components)

## Development Commands

```bash
npm run dev        # Start dev server on :3000
npm run build      # Production build
npm start          # Run production server
npm run lint       # Run ESLint
```

## Architecture

### Database Schema (Supabase)

The app uses five main tables:

1. **events** - Event metadata (title, description, date ranges, blocked dates, deadline, availability visibility)
2. **responses** - Respondent availability (name, display_name, response_type: available/unavailable, dates array, confirmed status, includes_so boolean)
3. **event_ownerships** - Event access control (links events to owner_user_id or owner_email, manage_token for private links)
4. **event_followups** - Hosting rounds (selected_date, timezone, status: draft/open/closed, calendar sync fields)
5. **event_followup_invites** - Tokenized invites for follow-up coordination (links responses to followups with unique invite_tokens)
6. **event_followup_answers** - Hosting responses (still_available boolean, preferred_start_time)

All tables use RLS (Row Level Security) allowing public read/write for events and responses, while event_ownerships requires authorization.

### Request Flow & Access Patterns

**Public Event Response Path** (`/respond/[slug]`):
- Fetch event by slug (public read)
- Create or retrieve response record by name + event_id (auto-generates guest numbers if unnamed)
- Track availability selections in refs, auto-save to DB every 2 seconds
- Support toggle between "available" and "unavailable" modes
- Show availability counts from confirmed responses if event.show_availability_counts is true

**Creator Access** (`/events/manage/[token]` and `/events/new`):
- Google OAuth via next-auth (scope: calendar.events for future integrations)
- Email claim: user enters email post-creation, system links ownership to account
- Private owner link: generated as manage_token in event_ownerships, saved in browser localStorage
- Three access paths merged: session.user.id, normalized session.user.email, or manage_token

**Admin Dashboard** (`/admin/*`):
- Session-based auth using sessionStorage (password: NEXT_PUBLIC_ADMIN_PASSWORD)
- Read-only access to all events and responses
- Create events, set blocked dates, manage deadlines
- Launch hosting follow-up rounds

### Key Client-Side Patterns

**State Management**:
- React hooks with refs for debounced saves (availableDatesRef, unavailableDatesRef, responseIdRef)
- Separate UI state (availableDates/unavailableDates) from saved data in refs to prevent race conditions
- useCallback dependencies carefully scoped to avoid infinite loops during auto-saves

**Data Persistence**:
- localStorage for user name (NAME_STORAGE_KEY), saved invite slugs (SAVED_INVITES_KEY), session keys (getSessionKey(slug))
- Debounced Supabase updates: 2000ms for date changes, 1000ms for names, 600ms for includes_so toggle
- Pending toggles buffered in refs until session starts (for race-condition safety before response record created)

**Save Strategy**:
- Unsaved selections trigger soft updates (confirmed: false)
- Only confirmed: true submissions lock in final state
- Reset functionality via snapshot mechanism (captures entire state, allows undo)

### Page Structure

```
app/
├── page.js                    # Hero/landing (sign-in, event links)
├── layout.js                  # Root layout with SessionProvider
├── globals.css                # Shared styles (calendar, buttons, dark theme)
├── respond/[slug]/page.js     # Public event response (calendar + availability submission)
├── followup/[token]/page.js   # Hosting follow-up form (timezone, time selection)
├── events/
│   ├── page.js                # User dashboard (saved invites + owned events via NextAuth)
│   ├── new/page.js            # Create event form
│   ├── [id]/page.js           # Event details/share page
│   └── manage/[token]/page.js # Manage event via private link or email claim
├── admin/
│   ├── layout.js              # Auth gate (password check via sessionStorage)
│   ├── page.js                # Admin menu
│   ├── create/page.js         # Event creation (admin path)
│   ├── events/page.js         # Event list with response counts
│   └── events/[id]/page.js    # Event admin panel (launch follow-ups, export data)
└── api/
    ├── auth/[...nextauth]/route.js     # NextAuth handler
    ├── events/route.js                 # Create event (POST, admin-protected)
    ├── events/[id]/route.js            # Event details (GET, owner-protected)
    └── events/manage/[token]/route.js  # Event updates (POST, token/owner-protected)
```

### Component Library

- **Calendar.js** - Date grid for selection (support for "available"/"unavailable" modes, availability counts overlay)
- **AdminCalendar.js** - Admin version with blocked date selection
- **EventOwnerPanel.js** - Launch hosting follow-ups, view responses, set deadlines
- **SessionProvider.js** - Wraps app with next-auth SessionProvider

### API Authorization Pattern

The backend uses a unified ownership check (resolveOwnership):
- Looks up event_ownerships record
- Verifies owner_user_id (Google session) OR owner_email (normalized, claimed email) OR owner_token (manage_token)
- Returns 403 if no match, allows mutations if match found
- Updates owner_user_id when email-claimed user signs in (consolidates access methods)

### Styling Approach

No Tailwind build; colors hardcoded from Tailwind palette:
- Dark background: #0f172a (slate-950)
- Cards: #1e293b (slate-800)
- Text: #e2e8f0 (slate-100), #94a3b8 (slate-400)
- Accents: #6366f1 (indigo), #10b981 (emerald), #ef4444 (red)

Common button classes in globals.css:
- `.button-primary` - Indigo background
- `.button-secondary` - Slate background
- `.submit-btn` - Full-width submit
- `.input-field` - Text input styling

## Environment Variables

Required for deployment:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY         # Server-only, for admin operations
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
NEXT_PUBLIC_ADMIN_PASSWORD        # Admin dashboard password
NEXTAUTH_SECRET                   # For JWT signing (auto-generated by next-auth)
NEXTAUTH_URL                      # Callback URL (prod: full domain, dev: http://localhost:3000)
```

## Important Implementation Details

### Date Handling

- All dates stored as ISO strings (YYYY-MM-DD format) in Supabase and refs
- Date range parsing: `new Date(dateString + 'T12:00:00')` (noon UTC to avoid timezone issues)
- Blocked dates: array of ISO strings filtered from calendar display

### Response Types

Responses store two complementary date arrays based on selection mode:
- "available" mode: only selected dates mark availability
- "unavailable" mode: selected dates mark unavailability (inverse logic)
- Availability counts computed by iterating responses and checking both type + dates

### Session & Confirmation Flow

1. User can make date selections before providing name (pending toggles in ref)
2. First selection triggers session creation (POST response record)
3. Session name auto-loads from localStorage (persistent across page reloads)
4. Name changes debounced and auto-saved
5. "Confirm" locks in state (confirmed: true), prevents further edits unless explicitly reset

### Timezone Support (Follow-up)

Hosting follow-up form normalizes time input (6pm, 18:30, 6:30pm all valid) and stores as TIME type in DB. Timezone selector uses IANA identifiers with offset labels computed via Intl.DateTimeFormat.

## Testing & Linting

```bash
npm run lint       # Runs ESLint (configured via eslint.config.mjs)
```

ESLint uses next/core-web-vitals config. No test suite currently configured.

## Deployment Notes

- All client components use 'use client' directive
- API routes set `dynamic = 'force-dynamic'` and `runtime = 'nodejs'` (required for NextAuth)
- RLS policies in Supabase must be enabled; app relies on them for access control
- Admin password passed via NEXT_PUBLIC_ADMIN_PASSWORD (client-visible by design, for UI-level gating)

