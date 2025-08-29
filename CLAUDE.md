# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TLDW (Too Long; Didn't Watch) is a Next.js 15 application that transforms long YouTube videos into topic-driven learning experiences using AI-generated "highlight reels" that identify and extract the most valuable insights scattered across entire video transcripts.

## Key Commands

**Development:**
```bash
npm run dev           # Start development server with Turbopack
```

**Build & Production:**
```bash
npm run build         # Build production bundle with Turbopack
npm start            # Start production server
```

## Architecture & Structure

### Core Application Flow
1. User inputs YouTube URL → `components/url-input.tsx`
2. Fetch transcript → `app/api/transcript/route.ts` (uses Supadata API)
3. Generate AI highlight reels → `app/api/generate-topics/route.ts` (Google Gemini 2.5 Flash)
4. Display highlight cards → `components/topic-card.tsx`
5. Show highlighted transcript → `components/transcript-viewer.tsx`
6. Control video playback → `components/youtube-player.tsx`
7. Interactive AI chat → `components/ai-chat.tsx` (context-aware Q&A)

### API Integration
- **Google Gemini API**: Generates 5 distinct highlight reels using custom prompts that identify cross-transcript themes
- **Supadata API**: Fetches YouTube transcripts with timestamps (requires `SUPADATA_API_KEY`)
- **YouTube IFrame API**: Embedded video player with programmatic control
- **Environment Variables**: Requires `GEMINI_API_KEY` and `SUPADATA_API_KEY` in `.env.local`

### Key Technical Decisions
- **Highlight Reels vs Chapters**: Unlike sequential chapters, highlight reels identify thematically related content across multiple non-contiguous segments
- **Quote Extraction**: Uses `findExactQuotes()` in `app/api/generate-topics/route.ts` to match AI-generated timestamps with actual transcript segments
- **Segment Merging**: Quotes within 5 seconds are merged to avoid fragmentation
- **Context Extension**: Automatically extends quote boundaries to capture complete thoughts (15-30 seconds minimum)
- **TypeScript Types**: Core types in `lib/types.ts` - `TranscriptSegment`, `Topic` (with segments & quotes), `Citation`, `ChatMessage`

### Component Architecture
- **State Management**: React hooks in `app/page.tsx` orchestrate the entire flow
- **Video Control**: YouTube player supports auto-playing highlight segments sequentially
- **Transcript Highlighting**: Multiple non-contiguous segments highlighted simultaneously
- **AI Chat**: Context-aware chat using full transcript with citation extraction
- **UI Components**: Radix UI primitives with Tailwind CSS styling
- **Path Aliases**: `@/` maps to project root for clean imports

### Utility Functions
- `extractVideoId()`: Parses YouTube URLs to extract video ID
- `formatDuration()`: Converts seconds to MM:SS format
- `formatTopicDuration()`: Human-readable duration (e.g., "5 min", "1h 30m")
- `getTopicColor()`: Assigns consistent colors to highlight reels

### Deployment
Optimized for Vercel deployment with Next.js 15 and Turbopack for fast builds and hot module replacement.