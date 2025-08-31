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
    console.log('Extracted video ID:', videoId, 'from URL:', url);
    
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      console.error('SUPADATA_API_KEY is not configured');
      return NextResponse.json(
        { error: 'API configuration error' },
        { status: 500 }
      );
    }

    let transcript;
    try {
      const response = await fetch(`https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Supadata API error:', response.status, errorData);
        
        if (response.status === 404) {
          return NextResponse.json(
            { error: 'No transcript/captions available for this video. The video may not have subtitles enabled.' },
            { status: 404 }
          );
        }
        
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      // The API returns data with a 'content' array containing the transcript segments
      transcript = data.content || data.transcript || data;
      
    } catch (fetchError: any) {
      console.error('Supadata transcript fetch error:', fetchError);
      if (fetchError.message?.includes('404')) {
        return NextResponse.json(
          { error: 'No transcript/captions available for this video. The video may not have subtitles enabled.' },
          { status: 404 }
        );
      }
      throw fetchError;
    }
    
    if (!transcript || (Array.isArray(transcript) && transcript.length === 0)) {
      return NextResponse.json(
        { error: 'No transcript available for this video' },
        { status: 404 }
      );
    }

    // Log sample of transcript for debugging
    if (Array.isArray(transcript) && transcript.length > 0) {
      console.log('Sample transcript segment:', transcript[0]);
      console.log('Total transcript segments BEFORE transformation:', transcript.length);
    }

    const transformedTranscript = Array.isArray(transcript) ? transcript.map((item, idx) => {
      const transformed = {
        text: item.text || item.content || '',
        // Convert milliseconds to seconds for offset/start
        start: (item.offset !== undefined ? item.offset / 1000 : item.start) || 0,
        // Convert milliseconds to seconds for duration
        duration: (item.duration !== undefined ? item.duration / 1000 : 0) || 0
      };
      
      // Check for empty segments
      if (!transformed.text || transformed.text.trim() === '') {
        console.warn(`  ⚠️ Empty segment at index ${idx}`);
      }
      
      // Debug segments around index 40-46
      if (idx >= 40 && idx <= 46) {
        console.log(`  📍 Transcript API - Segment ${idx}: "${transformed.text.substring(0, 40)}..."`);
      }
      
      return transformed;
    }) : [];
    
    console.log('Total transcript segments AFTER transformation:', transformedTranscript.length);

    return NextResponse.json({
      videoId,
      transcript: transformedTranscript
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}