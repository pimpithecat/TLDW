# Database Migrations

## Schema Overview

This directory contains SQL migrations for the TLDW application database.

### Tables

#### 1. `video_analyses`
Stores complete video analysis data including transcript, topics, and summary.

**Columns:**
- `id` (uuid, PK) - Unique identifier
- `youtube_id` (text, unique) - YouTube video ID
- `user_id` (uuid, FK → auth.users) - User who created the analysis (nullable)
- `title` (text) - Video title
- `author` (text) - Channel name
- `thumbnail_url` (text) - Thumbnail image URL
- `duration` (integer) - Video duration in seconds (nullable)
- `transcript` (jsonb) - Full transcript segments
- `topics` (jsonb) - Generated highlight topics
- `summary` (text) - AI-generated summary
- `suggested_questions` (jsonb) - AI-generated questions
- `translated_transcripts` (jsonb) - Cached transcript translations (EN ↔ ID)
- `created_at`, `updated_at` (timestamptz)

**RLS Policies:**
- Anyone can view (SELECT)
- Authenticated users can insert their own or anonymous analyses
- Users can update their own analyses

---

#### 2. `user_videos`
Tracks user's video access history and favorites.

**Columns:**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users, NOT NULL)
- `video_id` (uuid, FK → video_analyses, NOT NULL)
- `is_favorite` (boolean, default: false)
- `accessed_at` (timestamptz) - Last access time
- `created_at` (timestamptz)
- UNIQUE constraint on (user_id, video_id)

**RLS Policies:**
- Users can only view/modify their own records

---

#### 3. `user_notes`
User-created notes on videos.

**Columns:**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users, NOT NULL)
- `video_id` (uuid, FK → video_analyses, NOT NULL)
- `source` (text) - Note source: 'chat', 'takeaways', 'transcript', 'custom'
- `source_id` (text) - Reference to source entity
- `note_text` (text) - Note content
- `metadata` (jsonb) - Additional context (timestamps, positions, etc.)
- `created_at`, `updated_at` (timestamptz)

**RLS Policies:**
- Users can only view/modify their own notes

---

#### 4. `profiles`
User profile data and preferences.

**Columns:**
- `id` (uuid, PK, FK → auth.users)
- `topic_generation_mode` (text, CHECK: 'smart' | 'fast', default: 'smart')
- `full_name` (text)
- `avatar_url` (text)
- `email` (text)
- `free_generations_used` (integer, default: 0)
- `created_at`, `updated_at` (timestamptz)

**RLS Policies:**
- Users can only view/modify their own profile

**Trigger:**
- Auto-creates profile when new user signs up

---

#### 5. `rate_limits`
Rate limiting records for API endpoints.

**Columns:**
- `id` (uuid, PK)
- `key` (text) - Rate limit key (endpoint + identifier)
- `identifier` (text) - User/IP identifier
- `timestamp` (timestamptz)

**RLS Policies:**
- Anyone can insert/read/delete (for rate limiting functionality)

---

#### 6. `audit_logs`
Security audit trail for sensitive operations.

**Columns:**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `action` (text) - Action type (LOGIN, VIDEO_ANALYSIS_CREATE, etc.)
- `resource_type` (text) - Resource being accessed
- `resource_id` (text) - Specific resource identifier
- `details` (jsonb) - Additional context
- `ip_address` (text)
- `user_agent` (text)
- `created_at` (timestamptz)

**RLS Policies:**
- Anyone can insert (for logging)
- Users can view their own logs
- Service role has full access

---

### Functions

#### `handle_new_user()`
Trigger function that automatically creates a profile entry when a new user signs up.

#### `handle_updated_at()`
Trigger function that automatically updates the `updated_at` timestamp on UPDATE operations.

#### `upsert_video_analysis_with_user_link()`
Atomic function that upserts video analysis and links it to user's account in a single transaction.

---

### Indexes

Performance indexes are created on:
- Foreign keys (user_id, video_id, etc.)
- Frequently queried fields (youtube_id, accessed_at, created_at, etc.)
- Composite indexes for rate limiting queries

---

## Migration Files

- `20241026000000_create_complete_schema.sql` - **Complete unified schema** including:
  - All 6 tables with complete column definitions
  - All 3 functions (handle_new_user, handle_updated_at, upsert_video_analysis_with_user_link)
  - Complete RLS policies for security
  - Automatic triggers for timestamps and user profile creation
  - Transcript translation support (EN ↔ ID)
  - Performance indexes on all relevant fields

This is a **single comprehensive migration** that sets up the entire database schema.

---

## Security

All tables have Row Level Security (RLS) enabled with appropriate policies:
- **Isolation**: Users can only access their own data
- **Anonymous Access**: Video analyses are publicly viewable
- **Service Role**: Audit logs accessible by service role for admin operations

---

## Setup

These migrations are applied automatically when connecting to Supabase. 

For fresh setup:
1. Ensure environment variables are configured (see `.env.example`)
2. Migrations will be applied on first connection
3. User profiles are auto-created on signup via trigger

