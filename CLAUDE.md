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

### Key Technical Implementation
- **Transcript Processing**: Advanced text matching algorithms in `generate-topics/route.ts` including Boyer-Moore search, n-gram similarity, and fuzzy matching
- **Quote Extraction**: `findExactQuotes()` uses multiple strategies (exact, normalized, fuzzy) to match AI timestamps with actual transcript segments
- **Segment Merging**: Quotes within 5 seconds are automatically merged to avoid fragmentation
- **Context Extension**: Extends quote boundaries to capture complete thoughts (15-30 seconds minimum)
- **Citation System**: Chat responses include timestamped citations that link to video segments
- **Model Selection**: Supports Gemini 2.5 Flash and 2.0 Flash Thinking models

### Component Architecture
- **State Management**: React hooks in `app/page.tsx` orchestrate the entire flow
- **Loading States**: Multi-stage loading indicators with progress tracking
- **YouTube Player**: Custom wrapper supporting auto-play of highlight segments
- **Transcript Viewer**: Synchronized highlighting with video playback
- **AI Chat**: Maintains conversation history with citation highlighting
- **Video Progress Bar**: Visual timeline showing highlight segments

### TypeScript Types (`lib/types.ts`)
- `TranscriptSegment`: Individual transcript segment with timing
- `Topic`: Highlight reel with segments, quotes, and keywords
- `VideoInfo`: Video metadata (title, author, thumbnail, duration)
- `Citation`: Timestamped reference with context
- `ChatMessage`: Chat history with role and citations

### Utility Functions (`lib/utils.ts`)
- `extractVideoId()`: Parses YouTube URLs to extract video ID
- `formatDuration()`: Converts seconds to MM:SS format
- `formatTopicDuration()`: Human-readable duration (e.g., "5 min", "1h 30m")
- `getTopicColor()`: Assigns consistent colors to highlight reels
- `getTopicHSLColor()`: Returns HSL color values for dynamic theming

### Environment Variables
Required in `.env.local`:
- `GEMINI_API_KEY`: Google Gemini API key for AI generation
- `SUPADATA_API_KEY`: Supadata API key for transcript fetching

### Deployment
Optimized for Vercel deployment with Next.js 15 and Turbopack for fast builds and hot module replacement.