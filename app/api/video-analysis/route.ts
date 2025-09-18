import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TranscriptSegment, Topic, VideoInfo } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const {
      videoId,
      videoInfo,
      transcript,
      model = 'gemini-2.0-flash-exp',
      forceRegenerate = false
    } = await req.json();

    if (!videoId || !transcript || !videoInfo) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user if logged in
    const { data: { user } } = await supabase.auth.getUser();

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
          summary: cachedVideo.summary,
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
    console.error('Error in video analysis:', error);
    return NextResponse.json(
      { error: 'Failed to process video analysis' },
      { status: 500 }
    );
  }
}