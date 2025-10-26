-- ============================================================================
-- TLDW DATABASE SCHEMA - COMPLETE
-- ============================================================================
-- This migration creates all tables, indexes, RLS policies, functions, and triggers
-- required for the TLDW application.
--
-- Tables: video_analyses, user_videos, user_notes, profiles, rate_limits, audit_logs
-- Functions: handle_new_user, handle_updated_at, upsert_video_analysis_with_user_link
-- Features: RLS policies, automatic timestamps, user profile creation, transcript translations
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- VIDEO ANALYSES TABLE
-- Stores complete video analysis data including transcript, topics, and summary
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.video_analyses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  youtube_id text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  author text,
  thumbnail_url text,
  duration integer,
  transcript jsonb,
  topics jsonb,
  summary text,
  suggested_questions jsonb,
  translated_transcripts jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_analyses_youtube_id ON public.video_analyses(youtube_id);
CREATE INDEX IF NOT EXISTS idx_video_analyses_user_id ON public.video_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_video_analyses_translated_transcripts ON public.video_analyses USING gin(translated_transcripts);

COMMENT ON COLUMN public.video_analyses.translated_transcripts IS 
'Stores translated transcript segments in different languages. Format: {"id": [...], "en": [...]}';

-- ============================================================================
-- USER VIDEOS TABLE
-- Tracks user's video access history and favorites
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_videos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  video_id uuid REFERENCES public.video_analyses(id) ON DELETE CASCADE NOT NULL,
  is_favorite boolean DEFAULT false,
  accessed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_user_videos_user_id ON public.user_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_user_videos_video_id ON public.user_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_user_videos_accessed_at ON public.user_videos(accessed_at DESC);

-- ============================================================================
-- USER NOTES TABLE
-- User-created notes on videos with source metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  video_id uuid REFERENCES public.video_analyses(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL,
  source_id text,
  note_text text NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON public.user_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notes_video_id ON public.user_notes(video_id);

-- ============================================================================
-- PROFILES TABLE
-- User profile data and preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_generation_mode text NOT NULL DEFAULT 'smart' CHECK (topic_generation_mode IN ('smart', 'fast')),
  full_name text,
  avatar_url text,
  email text,
  free_generations_used integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ============================================================================
-- RATE LIMITS TABLE
-- Rate limiting records for API endpoints
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL,
  identifier text NOT NULL,
  timestamp timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key_timestamp ON public.rate_limits(key, timestamp);
CREATE INDEX IF NOT EXISTS idx_rate_limits_timestamp ON public.rate_limits(timestamp);

-- ============================================================================
-- AUDIT LOGS TABLE
-- Security audit trail for sensitive operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.video_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: VIDEO_ANALYSES
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view video analyses" ON public.video_analyses;
CREATE POLICY "Anyone can view video analyses" ON public.video_analyses
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own video analyses" ON public.video_analyses;
CREATE POLICY "Users can insert their own video analyses" ON public.video_analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own video analyses" ON public.video_analyses;
CREATE POLICY "Users can update their own video analyses" ON public.video_analyses
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================================
-- RLS POLICIES: USER_VIDEOS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own video access records" ON public.user_videos;
CREATE POLICY "Users can view their own video access records" ON public.user_videos
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own video access records" ON public.user_videos;
CREATE POLICY "Users can insert their own video access records" ON public.user_videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own video access records" ON public.user_videos;
CREATE POLICY "Users can update their own video access records" ON public.user_videos
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own video access records" ON public.user_videos;
CREATE POLICY "Users can delete their own video access records" ON public.user_videos
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES: USER_NOTES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own notes" ON public.user_notes;
CREATE POLICY "Users can view their own notes" ON public.user_notes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notes" ON public.user_notes;
CREATE POLICY "Users can insert their own notes" ON public.user_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notes" ON public.user_notes;
CREATE POLICY "Users can update their own notes" ON public.user_notes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notes" ON public.user_notes;
CREATE POLICY "Users can delete their own notes" ON public.user_notes
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES: PROFILES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================================
-- RLS POLICIES: RATE_LIMITS
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can insert rate limit records" ON public.rate_limits;
CREATE POLICY "Anyone can insert rate limit records" ON public.rate_limits
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read rate limit records" ON public.rate_limits;
CREATE POLICY "Anyone can read rate limit records" ON public.rate_limits
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can delete rate limit records" ON public.rate_limits;
CREATE POLICY "Anyone can delete rate limit records" ON public.rate_limits
  FOR DELETE USING (true);

-- ============================================================================
-- RLS POLICIES: AUDIT_LOGS
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can insert audit logs" ON public.audit_logs;
CREATE POLICY "Anyone can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view their own audit logs" ON public.audit_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage audit logs" ON public.audit_logs;
CREATE POLICY "Service role can manage audit logs" ON public.audit_logs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Function to atomically upsert video analysis and link to user
CREATE OR REPLACE FUNCTION public.upsert_video_analysis_with_user_link(
  p_youtube_id text,
  p_title text,
  p_author text DEFAULT NULL,
  p_duration integer DEFAULT NULL,
  p_thumbnail_url text DEFAULT NULL,
  p_transcript jsonb DEFAULT NULL,
  p_topics jsonb DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_suggested_questions jsonb DEFAULT NULL,
  p_model_used text DEFAULT 'gemini-2.5-flash',
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(video_analysis_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_video_id uuid;
  v_was_created boolean;
BEGIN
  -- Upsert video_analyses table
  INSERT INTO public.video_analyses (
    youtube_id,
    user_id,
    title,
    author,
    thumbnail_url,
    duration,
    transcript,
    topics,
    summary,
    suggested_questions
  )
  VALUES (
    p_youtube_id,
    p_user_id,
    p_title,
    p_author,
    p_thumbnail_url,
    p_duration,
    p_transcript,
    p_topics,
    p_summary,
    p_suggested_questions
  )
  ON CONFLICT (youtube_id) DO UPDATE SET
    title = COALESCE(EXCLUDED.title, video_analyses.title),
    author = COALESCE(EXCLUDED.author, video_analyses.author),
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, video_analyses.thumbnail_url),
    duration = COALESCE(EXCLUDED.duration, video_analyses.duration),
    transcript = COALESCE(EXCLUDED.transcript, video_analyses.transcript),
    topics = COALESCE(EXCLUDED.topics, video_analyses.topics),
    summary = COALESCE(EXCLUDED.summary, video_analyses.summary),
    suggested_questions = COALESCE(EXCLUDED.suggested_questions, video_analyses.suggested_questions),
    updated_at = now()
  RETURNING id, (xmax = 0) INTO v_video_id, v_was_created;

  -- If user is provided, link to user_videos table
  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.user_videos (user_id, video_id, accessed_at)
    VALUES (p_user_id, v_video_id, now())
    ON CONFLICT (user_id, video_id) DO UPDATE SET
      accessed_at = now();
  END IF;

  -- Return the video ID and creation status
  RETURN QUERY SELECT v_video_id, v_was_created;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.upsert_video_analysis_with_user_link TO authenticated, anon;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Triggers for updated_at columns
DROP TRIGGER IF EXISTS set_updated_at_video_analyses ON public.video_analyses;
CREATE TRIGGER set_updated_at_video_analyses
  BEFORE UPDATE ON public.video_analyses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_user_notes ON public.user_notes;
CREATE TRIGGER set_updated_at_user_notes
  BEFORE UPDATE ON public.user_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
