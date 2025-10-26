import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';

// Parse ISO 8601 duration format (e.g., PT1H2M10S) to seconds
function parseDuration(isoDuration: string): number {
  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = isoDuration.match(regex);
  
  if (!matches) return 0;
  
  const hours = parseInt(matches[1] || '0', 10);
  const minutes = parseInt(matches[2] || '0', 10);
  const seconds = parseInt(matches[3] || '0', 10);
  
  return hours * 3600 + minutes * 60 + seconds;
}

async function handler(request: NextRequest) {
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

    // Try YouTube Data API first if available
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (youtubeApiKey) {
      try {
        const youtubeUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${youtubeApiKey}`;
        const youtubeResponse = await fetch(youtubeUrl);

        if (youtubeResponse.ok) {
          const youtubeData = await youtubeResponse.json();
          const video = youtubeData.items?.[0];

          if (video) {
            // Parse ISO 8601 duration (e.g., PT1H2M10S)
            const duration = parseDuration(video.contentDetails.duration);

            return NextResponse.json({
              videoId,
              title: video.snippet.title || 'YouTube Video',
              author: video.snippet.channelTitle || 'Unknown',
              thumbnail: video.snippet.thumbnails?.maxres?.url || 
                        video.snippet.thumbnails?.high?.url || 
                        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
              duration,
              description: video.snippet.description || undefined,
              tags: video.snippet.tags || undefined
            });
          }
        }
      } catch (youtubeError) {
        console.error('[VIDEO-INFO] YouTube API error:', youtubeError);
      }
    }

    // Try Supadata API as fallback
    const supadataApiKey = process.env.SUPADATA_API_KEY;
    if (supadataApiKey) {
      try {
        const supadataUrl = `https://api.supadata.ai/v1/youtube/video?id=${videoId}`;

        const supadataResponse = await fetch(supadataUrl, {
          method: 'GET',
          headers: {
            'x-api-key': supadataApiKey,
            'Content-Type': 'application/json'
          }
        });

        if (supadataResponse.ok) {
          const supadataData = await supadataResponse.json();

          // Extract video metadata from Supadata response
          return NextResponse.json({
            videoId,
            title: supadataData.title || 'YouTube Video',
            author: supadataData.channel?.name || supadataData.author || 'Unknown',
            thumbnail: supadataData.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            duration: supadataData.duration || null,
            description: supadataData.description || undefined,
            tags: supadataData.tags || supadataData.keywords || undefined
          });
        }
      } catch (supadataError) {
        // Fall through to oEmbed if Supadata fails
        console.error('[VIDEO-INFO] Supadata API error:', {
          error: supadataError,
          message: (supadataError as Error).message,
          stack: (supadataError as Error).stack
        });
      }
    }

    // Fallback to YouTube oEmbed API (no API key required)
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
        duration: null // oEmbed doesn't provide duration or description
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

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);