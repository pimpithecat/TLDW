# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TLDW (Too Long; Didn't Watch) is a Next.js 15 application that transforms long YouTube videos into topic-driven learning experiences using AI-generated "highlight reels" that identify and extract the most valuable insights scattered across entire video transcripts.

## Key Commands

```bash
npm run dev           # Start development server with Turbopack
npm run build         # Build production bundle with Turbopack
npm start            # Start production server
```

## Architecture & Structure

### Core Application Flow
1. User inputs YouTube URL → `components/url-input.tsx`
2. Fetch video info → `app/api/video-info/route.ts` (metadata & thumbnails)
3. Fetch transcript → `app/api/transcript/route.ts` (uses Supadata API)
4. Generate AI highlight reels → `app/api/generate-topics/route.ts` (Google Gemini API)
5. Display highlight cards → `components/topic-card.tsx`
6. Show highlighted transcript → `components/transcript-viewer.tsx`
7. Control video playback → `components/youtube-player.tsx`
8. Interactive AI chat → `components/ai-chat.tsx` (context-aware Q&A)
9. Suggested questions → `app/api/suggested-questions/route.ts` (dynamic Q&A generation)

### API Routes
- `/api/transcript`: Fetches YouTube transcripts via Supadata API
- `/api/generate-topics`: Creates 5 highlight reels using Gemini (supports model selection)
- `/api/video-info`: Retrieves video metadata (title, author, duration, thumbnail)
- `/api/chat`: Powers context-aware AI chat with citation extraction
- `/api/suggested-questions`: Generates relevant questions based on video content
- `/api/quick-preview`: Fast topic preview generation
- `/api/generate-summary`: Creates comprehensive video summary using Gemini
- `/api/check-limit`: Validates rate limits for authenticated/anonymous users
- `/api/check-video-cache`: Checks if video analysis already exists
- `/api/video-analysis`: Fetches/stores analyzed video data in Supabase
- `/api/update-video-analysis`: Updates existing video analysis
- `/api/toggle-favorite`: Manages user video favorites
- `/api/link-video`: Links video analysis to authenticated user account

### Key Technical Implementation

#### Quote Matching System (`lib/quote-matcher.ts`)
- **Boyer-Moore Search**: Implements efficient substring search algorithm for exact matching
- **N-gram Similarity**: Calculates similarity using 3-gram Jaccard coefficient
- **Transcript Indexing**: Builds comprehensive indices with word positions and n-gram maps
- **Multi-strategy Matching**: Falls back from exact → normalized → fuzzy matching
- **Segment Mapping**: Maps text matches back to precise segment boundaries with character offsets

#### AI Processing with Gemini (`lib/gemini-client.ts`)
- **Model Cascade**: Automatically falls back through `gemini-2.5-pro-latest` → `gemini-2.5-flash-latest` → `gemini-2.5-flash-lite-latest`
- **Structured Output**: Converts Zod schemas to Gemini's schema format for type-safe responses
- **Retry Logic**: Detects overload/rate limit errors (503, 429) and tries next model
- **Timeout Handling**: Optional timeout support with graceful error handling

#### Authentication & Security
- **Supabase Auth**: User authentication with email/password and OAuth providers
- **Rate Limiting**: Different limits for anonymous (3 videos/30 min) vs authenticated users
- **Video Linking**: Post-authentication linking of anonymous analyses to user accounts
- **Favorites System**: Users can favorite and manage their analyzed videos
- **CSRF Protection**: Token-based CSRF validation for state-changing operations (`lib/csrf-protection.ts`)
- **Security Middleware**: Centralized security wrapper for API routes (`lib/security-middleware.ts`)
  - Rate limiting, auth checks, body size limits, security headers
  - Presets: `PUBLIC`, `AUTHENTICATED`, `STRICT`
- **Audit Logging**: Tracks security events, rate limits, and unauthorized access (`lib/audit-logger.ts`)
- **Input Sanitization**: DOMPurify-based sanitization for user input (`lib/sanitizer.ts`)

#### Async Operation Management (`lib/promise-utils.ts`)
- **AbortManager**: Centralized abort controller management with automatic cleanup and timeouts
- **backgroundOperation**: Non-blocking operations that log errors without disrupting UI
- Prevents memory leaks from abandoned requests during navigation/unmount

### Component Architecture
- **State Management**: React hooks in `app/page.tsx` orchestrate the entire flow
  - Page states: `IDLE`, `ANALYZING_NEW`, `LOADING_CACHED`
  - Loading stages: `fetching`, `understanding`, `generating`, `processing`
  - Centralized playback control via `PlaybackCommand` system
  - AbortManager cleanup on unmount to prevent memory leaks
- **Playback System**: Centralized command pattern for video control
  - Commands: `SEEK`, `PLAY_TOPIC`, `PLAY_SEGMENT`, `PLAY_ALL`, `PLAY_CITATIONS`, `PAUSE`
  - Playback context tracks segment boundaries for auto-pause/advance
  - "Play All" mode chains topics sequentially with automatic transitions
- **Loading States**: Multi-stage loading indicators with progress tracking
  - Shows elapsed time for generation and processing stages
  - Preview generation happens in parallel (non-blocking)
- **YouTube Player**: Custom wrapper supporting auto-play of highlight segments
- **Transcript Viewer**: Synchronized highlighting with video playback
- **AI Chat**: Maintains conversation history with citation highlighting
- **Video Progress Bar**: Visual timeline showing highlight segments
- **Auth Modal**: User authentication/registration flow
- **User Menu**: Account management dropdown
- **Loading Context**: Global loading state management

### TypeScript Types (`lib/types.ts`)
- `TranscriptSegment`: Individual transcript segment with timing
- `Topic`: Highlight reel with segments, quotes, and keywords
  - Includes character offsets (`startCharOffset`, `endCharOffset`) for precise highlighting
  - Optional `isCitationReel` flag for citation playback mode
- `VideoInfo`: Video metadata (title, author, thumbnail, duration, description, tags)
- `Citation`: Timestamped reference with precise segment and character offsets
- `ChatMessage`: Chat history with role and citations
- `PlaybackCommand`: Centralized playback control commands

### Parallel Processing Patterns
The application uses aggressive parallel processing to minimize latency:

1. **Initial Load**:
   - Transcript fetch + Video metadata fetch (parallel)
   - Quick preview generation (non-blocking background)

2. **Analysis Generation**:
   - Topics generation + Summary generation (parallel using `Promise.allSettled`)
   - Suggested questions generation (background after topics complete)
   - Database save operations (background)

3. **Cached Videos**:
   - Load all data from cache instantly
   - Generate missing summary in background if needed
   - Update database with new content in background

### Utility Functions (`lib/utils.ts`)
- `extractVideoId()`: Parses YouTube URLs to extract video ID
- `formatDuration()`: Converts seconds to MM:SS format
- `formatTopicDuration()`: Human-readable duration (e.g., "5 min", "1h 30m")
- `getTopicColor()`: Assigns consistent colors to highlight reels
- `getTopicHSLColor()`: Returns HSL color values for dynamic theming
- `cn()`: Tailwind CSS class merging utility

### Database Integration
- **Supabase Client**: Browser and server clients for data operations (`lib/supabase/client.ts`, `lib/supabase/server.ts`)
- **Tables**:
  - `video_analyses`: Stores complete video analysis (topics, summary, transcript, suggested questions)
  - `user_favorites`: User's favorited videos
  - `rate_limit_logs`: Tracks API usage for rate limiting
- **Caching Strategy**:
  - Check cache before processing (`/api/check-video-cache`)
  - Load cached data instantly, generate missing pieces in background
  - Anonymous user videos can be linked to account post-auth
- **User Data**: Persistent storage of user-specific analysis history

### Development Patterns

#### Error Handling
- Use `backgroundOperation` for non-critical operations (saving to DB, generating suggestions)
- Display user-friendly error messages, log technical details
- Graceful degradation: If summary generation fails, show error but keep topics visible

#### State Updates
- Batch related state updates together to minimize re-renders
- Use `useCallback` for memoized setters passed to child components
- Clear playback state when switching between modes (topics, citations, play all)

#### Request Lifecycle
- Create AbortControllers via `AbortManager` for all API requests
- Set appropriate timeouts (10s for metadata, 30s for transcripts, 60s for AI generation)
- Clean up controllers on component unmount or new request

#### Authentication Flow
1. Store `pendingVideoId` in sessionStorage before showing auth modal
2. After auth, check for pending video and link it to user account
3. Retry linking with exponential backoff if video not yet in database

### Environment Variables
Required in `.env.local`:
- `GEMINI_API_KEY`: Google Gemini API key for AI generation
- `SUPADATA_API_KEY`: Supadata API key for transcript fetching
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous key

### Deployment
Optimized for Vercel deployment with Next.js 15 and Turbopack for fast builds and hot module replacement.
