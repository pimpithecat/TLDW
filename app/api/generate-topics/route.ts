import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

interface ParsedTopic {
  title: string;
  description: string;
  quotes?: Array<{
    timestamp: string;
    text: string;
  }>;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const startTime = formatTime(s.start);
    const endTime = formatTime(s.start + s.duration);
    return `[${startTime}-${endTime}] ${s.text}`;
  }).join('\n');
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function findExactQuotes(
  transcript: TranscriptSegment[],
  timestampRanges: Array<{ start: string; end: string }>
): { start: number; end: number; text: string }[] {
  const quotes: { start: number; end: number; text: string }[] = [];
  
  for (const range of timestampRanges) {
    // Parse timestamp strings (format: "MM:SS")
    const [startMin, startSec] = range.start.split(':').map(Number);
    const [endMin, endSec] = range.end.split(':').map(Number);
    const startTime = startMin * 60 + startSec;
    const endTime = endMin * 60 + endSec;
    
    // Find all segments within this time range
    const relevantSegments: string[] = [];
    let actualStart = startTime;
    let actualEnd = endTime;
    let foundAny = false;
    
    for (const seg of transcript) {
      const segEnd = seg.start + seg.duration;
      
      // Check if segment overlaps with our time range
      if (seg.start <= endTime && segEnd >= startTime) {
        relevantSegments.push(seg.text);
        if (!foundAny) {
          actualStart = Math.max(seg.start, startTime);
          foundAny = true;
        }
        actualEnd = Math.min(segEnd, endTime);
      }
    }
    
    if (relevantSegments.length > 0) {
      quotes.push({
        start: actualStart,
        end: actualEnd,
        text: relevantSegments.join(' ')
      });
    }
  }
  
  return quotes;
}

export async function POST(request: Request) {
  try {
    const { transcript, videoId } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    // Fetch video metadata from Supadata API
    let videoTitle = '';
    let videoDescription = '';
    
    if (videoId) {
      try {
        const apiKey = process.env.SUPADATA_API_KEY;
        if (apiKey) {
          const metadataResponse = await fetch(`https://api.supadata.ai/v1/youtube/metadata?url=https://www.youtube.com/watch?v=${videoId}`, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json'
            }
          });

          if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            videoTitle = metadata.title || '';
            videoDescription = metadata.description || '';
            console.log('Fetched video metadata:', { title: videoTitle, descriptionLength: videoDescription.length });
          } else {
            console.warn('Failed to fetch video metadata:', metadataResponse.status);
          }
        }
      } catch (metadataError) {
        console.warn('Error fetching video metadata:', metadataError);
        // Continue without metadata if it fails
      }
    }

    const fullText = combineTranscript(transcript);
    
    // Log a sample of the transcript to help with debugging
    console.log('Analyzing transcript sample (first 200 chars):', fullText.substring(0, 200) + '...');
    console.log('Total transcript length:', fullText.length, 'characters');
    
    const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);

    const prompt = `## Role and Goal
You are an expert content strategist. Your goal is to analyze the provided video transcript and description to create 5 distinct "highlight reels." Each reel will focus on a single, powerful theme, supported by direct quotes from the speaker. The final output should allow a busy, intelligent viewer to absorb the video's most valuable insights in minutes.

## Target Audience
Your audience is forward-thinking and curious. They have a short attention span and are looking for contrarian insights, actionable mental models, and bold predictions, not generic advice.

## Your Task

### Step 1: Identify 5 Core Themes
Analyze the entire transcript to identify 5 key themes that are most valuable and thought-provoking.

**Theme/Title Criteria:**
- **Insightful:** It must challenge a common assumption or reframe a known concept.
- **Specific:** Avoid vague titles.
- **Format:** Must be a complete sentence or a question.
- **Concise:** Maximum of 10 words.
- **Synthesized:** The theme should connect ideas from different parts of the talk, not just one section.

### Step 2: Select Supporting Passages
For each theme, select 1 to 5 direct passages from the transcript that powerfully illustrate the core idea.

**Passage Selection Criteria:**
- **Direct Quotes Only:** Use complete, unedited sentences from the transcript. Do NOT summarize, paraphrase, or use ellipses.
- **Self-Contained:** IMPORTANT: Each passage must be understandable on its own without surrounding context. Include surrounding context until quotes are full sentences.
- **High-Signal:** Choose passages that contain memorable stories, bold predictions, or contrarian thinking.
- **No Fluff:** Avoid introductions, transition phrases, or generic commentary.
- **Avoid Redundancy:** Within a single reel, ensure each selected passage offers a unique angle on the theme.
- **Chronological:** Within each reel, list the passages in the order they appear in the video.

## Quality Control
- **Distinct Themes:** Each highlight reel's title must represent a clearly distinct theme. While themes can be related, their core ideas should be unique.
- **Value Over Quantity:** If you can only identify 3-4 high-quality, distinct themes, deliver that number. Do not force generic themes to meet the count of 5.

## Output Format
You must return a JSON array with this EXACT structure:
[
  {
    "title": "Complete sentence or question",
    "quotes": [
      {
        "timestamp": "[MM:SS-MM:SS]",
        "text": "Exact transcript of passage as it appears"
      }
    ]
  }
]

## Video Information
**Title:** ${videoTitle || 'Not available'}
**Description:** ${videoDescription ? videoDescription.substring(0, 500) + (videoDescription.length > 500 ? '...' : '') : 'Not available'}

## Video Transcript (with timestamps)
${transcriptWithTimestamps}

`;
    
    

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    if (!response) {
      throw new Error('No response from Gemini');
    }

    console.log('Raw Gemini response:', response);
    const parsedResponse = JSON.parse(response);
    console.log('Parsed Gemini response:', JSON.stringify(parsedResponse, null, 2));
    
    // Handle different possible response structures
    let topicsArray = parsedResponse;
    if (parsedResponse.topics && Array.isArray(parsedResponse.topics)) {
      topicsArray = parsedResponse.topics;
    } else if (parsedResponse.themes && Array.isArray(parsedResponse.themes)) {
      topicsArray = parsedResponse.themes;
    } else if (!Array.isArray(parsedResponse)) {
      console.error('Unexpected response structure:', parsedResponse);
      throw new Error('Invalid response format from Gemini - not an array');
    }
    
    console.log(`Found ${topicsArray.length} highlight reels from Gemini`);
    
    // Validate that topics have required fields
    topicsArray.forEach((topic: ParsedTopic, index: number) => {
      console.log(`Highlight Reel ${index + 1}:`, {
        title: topic.title,
        hasQuotes: !!topic.quotes,
        quoteCount: topic.quotes ? topic.quotes.length : 0
      });
    });

    // Generate topics with segments from quotes
    const topicsWithSegments = topicsArray.map((topic: ParsedTopic, index: number) => {
      console.log(`\nProcessing Highlight Reel ${index + 1}: "${topic.title}"`);
      
      // Extract timestamp ranges from quotes
      const timestampRanges: Array<{ start: string; end: string }> = [];
      
      if (topic.quotes && Array.isArray(topic.quotes)) {
        topic.quotes.forEach((quote: any) => {
          // Parse timestamp format "[MM:SS-MM:SS]" or "MM:SS-MM:SS"
          const timestampMatch = quote.timestamp?.match(/\[?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]?/);
          if (timestampMatch) {
            timestampRanges.push({
              start: timestampMatch[1],
              end: timestampMatch[2]
            });
          }
        });
      }
      
      console.log(`Found ${timestampRanges.length} quotes with timestamps`);
      
      // Find the exact segments for these timestamps
      const segments = findExactQuotes(transcript, timestampRanges);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      console.log(`Result: Found ${segments.length} quote segments covering ${Math.round(totalDuration)} seconds`);
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: Math.round(totalDuration),
        segments: segments,
        quotes: topic.quotes // Store original quotes for display
      };
    });
    
    // Keep all topics, even those without segments (they can still be displayed)
    const topics = topicsWithSegments.length > 0 ? topicsWithSegments : 
      topicsArray.map((topic: ParsedTopic, index: number) => ({
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: 0,
        segments: [],
        quotes: topic.quotes || []
      }));
    
    console.log(`Total highlight reels: ${topics.length} (${topicsWithSegments.filter((t: Topic) => t.segments.length > 0).length} with segments)`)

    return NextResponse.json({ topics });
  } catch (error) {
    console.error('Error generating topics:', error);
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}