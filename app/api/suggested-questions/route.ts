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
    const {
      transcript,
      topics,
      videoTitle,
      count,
      exclude,
      lastQuestion,
    } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    const requestedCountRaw = typeof count === 'number' ? Math.round(count) : 3;
    const requestedCount = Math.min(Math.max(requestedCountRaw, 1), 5);

    const excludeList = Array.isArray(exclude)
      ? exclude
          .filter((item: unknown): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(item => item.length > 0)
      : [];
    const uniqueExclude = Array.from(new Set(excludeList));
    const excludeLower = new Set(uniqueExclude.map(item => item.toLowerCase()));

    const lastViewerQuestion = typeof lastQuestion === 'string'
      ? lastQuestion.trim()
      : '';

    const fallbackPool = [
      "What evidence backs the main claim?",
      "How do the key steps connect?",
      "Why does this insight matter now?",
      "What example clarifies the takeaway?",
      "How can I apply this idea today?"
    ];
    const supplementalFallbacks = [
      "Which detail should I double-check in the transcript?",
      "Where does the speaker justify this idea?"
    ];

    const buildFallback = () => {
      const results: string[] = [];
      for (const question of fallbackPool) {
        if (results.length >= requestedCount) break;
        if (excludeLower.has(question.toLowerCase())) continue;
        results.push(question);
      }
      for (const question of supplementalFallbacks) {
        if (results.length >= requestedCount) break;
        if (excludeLower.has(question.toLowerCase())) continue;
        if (!results.some(existing => existing.toLowerCase() === question.toLowerCase())) {
          results.push(question);
        }
      }
      while (results.length < requestedCount) {
        const filler = "What detail should I revisit in the transcript?";
        if (!results.some(existing => existing.toLowerCase() === filler.toLowerCase())
          && !excludeLower.has(filler.toLowerCase())) {
          results.push(filler);
        } else {
          results.push("Which statement deserves closer scrutiny?");
        }
      }
      return results.slice(0, requestedCount);
    };

    const exclusionsSection = uniqueExclude.length
      ? uniqueExclude.map(q => `  <item>${q}</item>`).join('\n')
      : '  <item>None</item>';

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
<viewerContext>
  <lastViewerQuestion>${lastViewerQuestion || 'None provided'}</lastViewerQuestion>
  <excludedQuestions>
${exclusionsSection}
  </excludedQuestions>
</viewerContext>
<goal>Generate exactly ${requestedCount} fresh, non-overlapping questions that deepen understanding of the transcript.</goal>
<instructions>
  <item>Every question must be fully answerable using the transcript alone.</item>
  <item>Avoid any theme that overlaps the provided highlight reels.</item>
  <item>Keep each question under 12 words and use direct, concrete language.</item>
  <item>Prefer "what", "how", or "why" framing over yes/no or multi-part prompts.</item>
  <item>Skip filler like "Can you explain" or "Could you talk about".</item>
  <item>Do not repeat excluded or previously asked questions verbatim.</item>
  <item>If a last viewer question is provided, build on it with a complementary angle.</item>
  <item>Focus on concrete facts, reasoning, examples, or explanations explicitly stated in the transcript.</item>
</instructions>
<validationChecklist>
  <item>If you cannot point to the exact supporting sentences, discard the question.</item>
  <item>Ensure the questions cover distinct ideas.</item>
</validationChecklist>
<outputFormat>Return strict JSON with exactly ${requestedCount} strings: ["question 1","question 2",...]. No additional text.</outputFormat>
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
    } catch {
      response = '';
    }

    if (!response) {
      return NextResponse.json({
        questions: buildFallback()
      });
    }

    let questions: string[] = [];
    try {
      const parsed = JSON.parse(response);
      questions = suggestedQuestionsSchema.parse(parsed);
    } catch {
      questions = [];
    }

    const normalizeQuestion = (value: string) =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

    const normalized = Array.from(new Set(
      questions
        .filter(q => typeof q === 'string')
        .map(normalizeQuestion)
        .filter(q => q.length > 0)
    ));

    const filtered = normalized.filter(q => !excludeLower.has(q.toLowerCase()));

    let finalQuestions = filtered.slice(0, requestedCount);

    if (finalQuestions.length < requestedCount) {
      const fallback = buildFallback();
      for (const candidate of fallback) {
        if (finalQuestions.length >= requestedCount) {
          break;
        }
        if (!finalQuestions.some(existing => existing.toLowerCase() === candidate.toLowerCase())) {
          finalQuestions.push(candidate);
        }
      }
    }

    if (finalQuestions.length === 0) {
      finalQuestions = buildFallback();
    }

    return NextResponse.json({ questions: finalQuestions.slice(0, requestedCount) });
  } catch {
    return NextResponse.json(
      { questions: [
        "What evidence backs the main claim?",
        "How do the key steps connect?",
        "Why does this insight matter now?"
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
