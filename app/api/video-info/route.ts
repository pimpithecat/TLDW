import { NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // Use YouTube oEmbed API (no API key required)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    
    try {
      const response = await fetch(oembedUrl);
      
      if (!response.ok) {
        // Return minimal info if oEmbed fails
        return NextResponse.json({
          videoId,
          title: 'YouTube Video',
          author: 'Unknown',
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: null
        });
      }

      const data = await response.json();
      
      return NextResponse.json({
        videoId,
        title: data.title || 'YouTube Video',
        author: data.author_name || 'Unknown',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: null // oEmbed doesn't provide duration, would need YouTube Data API
      });
      
    } catch (fetchError) {
      // Return minimal info on error
      return NextResponse.json({
        videoId,
        title: 'YouTube Video',
        author: 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: null
      });
    }
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch video information' },
      { status: 500 }
    );
  }
}