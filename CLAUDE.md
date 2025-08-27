# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TLDW (Too Long; Didn't Watch) is a Next.js 15 application that transforms long YouTube videos into topic-driven learning experiences using AI-generated smart topics that span across entire transcripts.

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
2. Fetch transcript → `app/api/transcript/route.ts` (uses youtube-transcript library)
3. Generate AI topics → `app/api/generate-topics/route.ts` (OpenAI GPT-4)
4. Display topics → `components/topic-card.tsx`
5. Show highlighted transcript → `components/transcript-viewer.tsx`
6. Control video playback → `components/youtube-player.tsx`

### API Integration
- **OpenAI API**: Topic generation using GPT-4o-mini with custom prompts for cross-transcript topic identification
- **YouTube**: Transcript fetching via youtube-transcript library, video playback via YouTube IFrame API
- **Environment**: Requires `OPENAI_API_KEY` in `.env.local`

### Key Technical Decisions
- **Cross-Transcript Topics**: Unlike chronological chapters, topics identify thematically related content scattered across multiple video segments
- **Segment Grouping**: Related transcript segments within 30 seconds are merged to avoid fragmentation
- **Topic Quality**: Limited to 10,000 characters of transcript to prevent token overflow while maintaining context
- **TypeScript Types**: Core types defined in `lib/types.ts` (TranscriptSegment, Topic, VideoData)

### Component Architecture
- **State Management**: React hooks in `app/page.tsx` manage video processing flow
- **Video Control**: YouTube player integration supports seeking to specific timestamps and auto-playing topic segments
- **Transcript Highlighting**: Dynamic highlighting based on selected topic's segment timestamps
- **Path Aliases**: `@/` maps to root directory for clean imports

### Deployment
Optimized for Vercel deployment with Next.js 15 and Turbopack for fast builds and hot module replacement.