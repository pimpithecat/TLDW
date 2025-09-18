import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { videoId, isFavorite } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // First, get the video from video_analyses table using the YouTube ID
    const { data: video, error: videoError } = await supabase
      .from('video_analyses')
      .select('id')
      .eq('youtube_id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Update the favorite status in user_videos table
    const { data, error } = await supabase
      .from('user_videos')
      .update({ is_favorite: isFavorite })
      .eq('user_id', user.id)
      .eq('video_id', video.id)
      .select()
      .single();

    if (error) {
      // If the record doesn't exist, create it
      if (error.code === 'PGRST116') {
        const { data: newData, error: insertError } = await supabase
          .from('user_videos')
          .insert({
            user_id: user.id,
            video_id: video.id,
            is_favorite: isFavorite,
            accessed_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        return NextResponse.json({
          success: true,
          isFavorite: newData.is_favorite
        });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      isFavorite: data.is_favorite
    });

  } catch (error) {
    console.error('Error toggling favorite:', error);
    return NextResponse.json(
      { error: 'Failed to toggle favorite status' },
      { status: 500 }
    );
  }
}