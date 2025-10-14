import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, Topic } from '@/lib/types';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateWithFallback } from '@/lib/gemini-client';
import { suggestedQuestionsSchema } from '@/lib/schemas';

function formatTranscriptForContext(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `[${timestamp}] ${s.text}`;
  }).join('\n');
}

async function handler(request: NextRequest) {
  try {
    const { transcript, topics, videoTitle } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    const fullTranscript = formatTranscriptForContext(transcript);
    const topicsContext = Array.isArray(topics) && topics.length > 0
      ? topics.map((t: Topic) => {
          const suffix = t.description ? `: ${t.description}` : '';
          return `${t.title}${suffix}`;
        }).join('\n')
      : 'None provided';

    const prompt = `<task>
<role>You craft grounded follow-up questions for viewers after watching a video.</role>
<context>
<videoTitle>${videoTitle || 'Untitled Video'}</videoTitle>
<coveredHighlights>
${topicsContext}
</coveredHighlights>
</context>
<goal>Generate exactly three fresh, non-overlapping questions that deepen understanding of the transcript.</goal>
<instructions>
  <item>Every question must be fully answerable using the transcript alone.</item>
  <item>Avoid any theme that overlaps the provided highlight reels.</item>
  <item>Keep each question under 15 words and written in the transcript's primary language.</item>
  <item>Prefer "what", "how", or "why" framing over yes/no or multi-part prompts.</item>
  <item>Focus on concrete facts, reasoning, examples, or explanations explicitly stated in the transcript.</item>
</instructions>
<validationChecklist>
  <item>If you cannot point to the exact supporting sentences, discard the question.</item>
  <item>Ensure the three questions cover distinct ideas.</item>
</validationChecklist>
<outputFormat>Return strict JSON with exactly three strings: ["question 1","question 2","question 3"]. No additional text.</outputFormat>
<transcript><![CDATA[
${fullTranscript}
]]></transcript>
</task>`;

    let response = '';

    try {
      response = await generateWithFallback(prompt, {
        generationConfig: {
          temperature: 0.6,
        },
        zodSchema: suggestedQuestionsSchema
      });
    } catch (error: any) {
      response = '';
    }

    if (!response) {
      return NextResponse.json({
        questions: [
          "What contrarian or surprising insights challenge conventional thinking?",
          "What specific examples or case studies illustrate the key concepts?",
          "What are the practical implications for someone in my field?"
        ]
      });
    }

    let questions: string[] = [];
    try {
      const parsed = JSON.parse(response);
      questions = suggestedQuestionsSchema.parse(parsed);
    } catch (parseError) {
      questions = [];
    }

    questions = questions
      .filter(q => typeof q === 'string' && q.trim().length > 0)
      .map(q => q.trim())
      .slice(0, 3);
    
    
    if (questions.length === 0) {
      questions = [
        "What's the most actionable advice I can apply immediately?",
        "Which ideas challenge my current assumptions?",
        "What evidence or data supports the main arguments?"
      ];
    }

    return NextResponse.json({ questions });
  } catch (error) {
    return NextResponse.json(
      { questions: [
        "What's the most actionable advice I can apply immediately?",
        "Which ideas challenge my current assumptions?",
        "What evidence or data supports the main arguments?"
      ] },
      { status: 200 }
    );
  }
}

// Apply security with generation rate limits
export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.AUTH_GENERATION, // Use authenticated rate limit
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts
  allowedMethods: ['POST']
});
