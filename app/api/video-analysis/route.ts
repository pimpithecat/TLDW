import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { videoAnalysisRequestSchema, formatValidationError } from '@/lib/validation';
import { RateLimiter, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limiter';
import { z } from 'zod';

export async function POST(req: NextRequest) {
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

    // Apply rate limiting
    const rateLimitConfig = user ? RATE_LIMITS.AUTH_GENERATION : RATE_LIMITS.ANON_GENERATION;
    const rateLimitResult = await RateLimiter.check('video-analysis', rateLimitConfig);

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult) || NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Check for cached analysis if not forcing regeneration
    if (!forceRegenerate) {
      const { data: cachedVideo } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('youtube_id', videoId)
        .single();

      if (cachedVideo && cachedVideo.topics) {
        // If user is logged in, track their access to this video
        if (user) {
          await supabase
            .from('user_videos')
            .upsert({
              user_id: user.id,
              video_id: cachedVideo.id,
              accessed_at: new Date().toISOString()
            }, {
              onConflict: 'user_id,video_id'
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

    // Generate new topics using existing logic
    // Use the request's origin to construct the API URL
    const origin = req.headers.get('origin') || req.headers.get('host')
      ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}`
      : 'http://localhost:3000';

    const generateResponse = await fetch(`${origin}/api/generate-topics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript, model })
    });

    if (!generateResponse.ok) {
      const error = await generateResponse.json();
      return NextResponse.json(error, { status: generateResponse.status });
    }

    const { topics } = await generateResponse.json();

    // Save to database
    const { data: savedVideo, error: saveError } = await supabase
      .from('video_analyses')
      .upsert({
        youtube_id: videoId,
        title: videoInfo.title,
        author: videoInfo.author,
        duration: videoInfo.duration,
        thumbnail_url: videoInfo.thumbnail,
        transcript: transcript,
        topics: topics,
        summary: summary,
        suggested_questions: suggestedQuestions,
        model_used: model,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'youtube_id'
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving video analysis:', saveError);
      // Still return the generated topics even if saving failed
      return NextResponse.json({ topics, cached: false });
    }

    // If user is logged in, link video to their account
    if (user && savedVideo) {
      await supabase
        .from('user_videos')
        .upsert({
          user_id: user.id,
          video_id: savedVideo.id,
          accessed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,video_id'
        });
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