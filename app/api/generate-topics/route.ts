import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { TranscriptSegment, Topic } from '@/lib/types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

interface SegmentGroup {
  start: number;
  end: number;
  texts: string[];
}

function findRelevantSegments(
  transcript: TranscriptSegment[],
  topicKeywords: string[]
): { start: number; end: number; text: string }[] {
  const segments: { start: number; end: number; text: string }[] = [];
  const lowerKeywords = topicKeywords.map(k => k.toLowerCase());
  
  let currentSegment: SegmentGroup | null = null;
  
  for (const seg of transcript) {
    const lowerText = seg.text.toLowerCase();
    const isRelevant = lowerKeywords.some(keyword => lowerText.includes(keyword));
    
    if (isRelevant) {
      if (currentSegment && seg.start - currentSegment.end < 30) {
        // Extend current segment if close enough (within 30 seconds)
        currentSegment.end = seg.start + seg.duration;
        currentSegment.texts.push(seg.text);
      } else {
        // Save previous segment if exists
        if (currentSegment) {
          segments.push({
            start: currentSegment.start,
            end: currentSegment.end,
            text: currentSegment.texts.join(' ')
          });
        }
        // Start new segment
        currentSegment = {
          start: seg.start,
          end: seg.start + seg.duration,
          texts: [seg.text]
        };
      }
    }
  }
  
  // Save last segment if exists
  if (currentSegment) {
    segments.push({
      start: currentSegment.start,
      end: currentSegment.end,
      text: currentSegment.texts.join(' ')
    });
  }
  
  return segments;
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

    const fullText = combineTranscript(transcript);
    
    const systemPrompt = `You are an expert at analyzing video transcripts and identifying key topics that span across the entire content. Your task is to generate 4-6 specific, valuable topics that capture insights scattered throughout the video.

Each topic should:
- Be specific and actionable (not generic like "Introduction" or "Conclusion")
- Capture a complete perspective that may be discussed in multiple parts of the video
- Have a compelling title that makes viewers want to watch
- Include relevant keywords that appear in the transcript

Return a JSON array of topics with this structure:
[
  {
    "title": "Specific, engaging topic title",
    "description": "1-2 sentence description of what this topic covers",
    "keywords": ["keyword1", "keyword2", "keyword3"]
  }
]`;

    const userPrompt = `Analyze this video transcript and identify 4-6 cross-cutting topics that capture the most valuable insights. Focus on themes that appear multiple times throughout the video, not just chronological chapters.

Transcript:
${fullText.substring(0, 10000)} // Limit to prevent token overflow

Generate topics in JSON format.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const response = completion.choices[0].message.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const parsedResponse = JSON.parse(response);
    const topicsArray = parsedResponse.topics || parsedResponse;
    
    if (!Array.isArray(topicsArray)) {
      throw new Error('Invalid response format from OpenAI');
    }

    // Generate topics with segments
    const topics: Topic[] = topicsArray.map((topic, index) => {
      const segments = findRelevantSegments(transcript, topic.keywords || []);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description,
        duration: Math.round(totalDuration),
        segments: segments
      };
    }).filter(topic => topic.segments.length > 0); // Only keep topics with segments

    return NextResponse.json({ topics });
  } catch (error) {
    console.error('Error generating topics:', error);
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}