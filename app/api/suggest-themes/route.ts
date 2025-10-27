import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateThemesFromTranscript } from '@/lib/ai-processing';

async function handler(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get video analysis to access transcript
    const { data: video, error: videoError } = await supabase
      .from('video_analyses')
      .select('transcript, title, author, duration, thumbnail_url, topics')
      .eq('youtube_id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Generate suggested themes
    const suggestedThemes = await generateThemesFromTranscript(
      video.transcript,
      {
        title: video.title,
        author: video.author,
        duration: video.duration,
        thumbnail: video.thumbnail_url
      }
    );

    // Create placeholder topics
    const existingTopics = video.topics || [];
    const existingThemeNames = new Set(
      existingTopics
        .filter((t: any) => t.theme)
        .map((t: any) => t.theme)
    );

    // Only add themes that don't already exist
    const newThemes = suggestedThemes.filter(theme => !existingThemeNames.has(theme));
    
    const placeholderTopics = newThemes.map((themeName, idx) => ({
      id: `placeholder-${Date.now()}-${idx}`,
      title: themeName,
      theme: themeName,
      duration: 0,
      segments: []
    }));

    // Append placeholders to existing topics
    const updatedTopics = [...existingTopics, ...placeholderTopics];

    // Update database
    const { error: updateError } = await supabase
      .from('video_analyses')
      .update({ topics: updatedTopics })
      .eq('youtube_id', videoId);

    if (updateError) {
      console.error('Error updating video with suggested themes:', updateError);
      return NextResponse.json(
        { error: 'Failed to save suggested themes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      suggestedThemes: newThemes
    });

  } catch (error) {
    console.error('Error in suggest-themes endpoint:', error);
    return NextResponse.json(
      { error: 'An error occurred while generating theme suggestions' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
