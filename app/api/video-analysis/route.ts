import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { videoAnalysisRequestSchema, formatValidationError } from '@/lib/validation';
import { RateLimiter, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limiter';
import { z } from 'zod';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateTopicsFromTranscript } from '@/lib/ai-processing';

async function handler(req: NextRequest) {
  try {
    // Parse and validate request body
    const body = await req.json();

    let validatedData;
    try {
      validatedData = videoAnalysisRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const {
      videoId,
      videoInfo,
      transcript,
      model,
      forceRegenerate,
      summary,
      suggestedQuestions
    } = validatedData;

    const supabase = await createClient();

    // Get current user if logged in
    const { data: { user } } = await supabase.auth.getUser();

    // Check for cached analysis FIRST (before consuming rate limit)
    if (!forceRegenerate) {
      const { data: cachedVideo } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('youtube_id', videoId)
        .single();

      if (cachedVideo && cachedVideo.topics) {
        // If user is logged in, track their access to this video atomically
        if (user) {
          await supabase.rpc('upsert_video_analysis_with_user_link', {
            p_youtube_id: videoId,
            p_title: cachedVideo.title,
            p_author: cachedVideo.author,
            p_duration: cachedVideo.duration,
            p_thumbnail_url: cachedVideo.thumbnail_url,
            p_transcript: cachedVideo.transcript,
            p_topics: cachedVideo.topics,
            p_summary: cachedVideo.summary || null,  // Ensure null instead of undefined
            p_suggested_questions: cachedVideo.suggested_questions || null,
            p_model_used: cachedVideo.model_used,
            p_user_id: user.id
          });
        }

        return NextResponse.json({
          topics: cachedVideo.topics,
          transcript: cachedVideo.transcript,
          videoInfo: {
            title: cachedVideo.title,
            author: cachedVideo.author,
            duration: cachedVideo.duration,
            thumbnail: cachedVideo.thumbnail_url
          },
          summary: cachedVideo.summary,
          suggestedQuestions: cachedVideo.suggested_questions,
          cached: true,
          cacheDate: cachedVideo.created_at
        });
      }
    }

    // Only apply rate limiting for NEW video analysis (not cached)
    const rateLimitConfig = user ? RATE_LIMITS.AUTH_GENERATION : RATE_LIMITS.ANON_GENERATION;
    const rateLimitResult = await RateLimiter.check('video-analysis', rateLimitConfig);

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult) || NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Generate new topics using shared function
    let topics;
    try {
      topics = await generateTopicsFromTranscript(transcript, model);
    } catch (error) {
      console.error('Error generating topics:', error);
      return NextResponse.json(
        { error: 'Failed to generate topics. Please try again.' },
        { status: 500 }
      );
    }

    // Use transactional RPC function to save video and link to user atomically
    const { data: result, error: saveError } = await supabase
      .rpc('upsert_video_analysis_with_user_link', {
        p_youtube_id: videoId,
        p_title: videoInfo.title,
        p_author: videoInfo.author,
        p_duration: videoInfo.duration,
        p_thumbnail_url: videoInfo.thumbnail,
        p_transcript: transcript,
        p_topics: topics,
        p_summary: summary || null,  // Ensure null instead of undefined
        p_suggested_questions: suggestedQuestions || null,  // Ensure null instead of undefined
        p_model_used: model,
        p_user_id: user?.id || null
      })
      .single();

    if (saveError) {
      console.error('Error saving video analysis:', saveError);
      // Return error response - do not return topics if save failed
      return NextResponse.json(
        {
          error: 'Failed to save video analysis. Please try again.',
          details: saveError.message
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      topics,
      cached: false,
      saved: true
    });

  } catch (error) {
    // Log error details server-side only
    console.error('Error in video analysis:', error);

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);