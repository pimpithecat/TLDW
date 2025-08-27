import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
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

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    
    if (!transcript || transcript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript available for this video' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      videoId,
      transcript: transcript.map(item => ({
        text: item.text,
        start: item.offset / 1000, // Convert to seconds
        duration: item.duration / 1000
      }))
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}