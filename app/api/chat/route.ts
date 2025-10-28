import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, Topic, ChatMessage, Citation } from '@/lib/types';
import { normalizeTimestampSources } from '@/lib/timestamp-normalization';
import { extractTimestamps, parseTimestamp } from '@/lib/timestamp-utils';
import { chatRequestSchema, formatValidationError } from '@/lib/validation';
import { RateLimiter, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limiter';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { withSecurity } from '@/lib/security-middleware';
import { generateWithFallback } from '@/lib/gemini-client';
import { chatResponseSchema } from '@/lib/schemas';

function formatTranscriptForContext(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `[${timestamp}] ${s.text}`;
  }).join('\n');
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function recoverPartialResponse(raw: string): { answer: string; timestamps?: string[] } | null {
  const answerMatch = raw.match(/"answer"\s*:\s*"([\s\S]*?)"/);
  if (!answerMatch) {
    return null;
  }

  const answerValue = answerMatch[1];
  let decodedAnswer = answerValue;
  try {
    decodedAnswer = JSON.parse(
      `"${answerValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    );
  } catch {
    decodedAnswer = answerValue.replace(/\\"/g, '"');
  }

  const timestampMatches = raw.match(/\b\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g) ?? [];
  const uniqueTimestamps = Array.from(new Set(timestampMatches)).slice(0, 5);

  return uniqueTimestamps.length > 0
    ? { answer: decodedAnswer, timestamps: uniqueTimestamps }
    : { answer: decodedAnswer };
}

function findClosestSegment(transcript: TranscriptSegment[], targetSeconds: number): { segment: TranscriptSegment; index: number } | null {
  if (!transcript || transcript.length === 0) return null;
  
  let closestIndex = 0;
  let minDiff = Math.abs(transcript[0].start - targetSeconds);
  
  for (let i = 1; i < transcript.length; i++) {
    const diff = Math.abs(transcript[i].start - targetSeconds);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  
  return {
    segment: transcript[closestIndex],
    index: closestIndex
  };
}

async function handler(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();

    let validatedData;
    try {
      validatedData = chatRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const { message, transcript, topics, chatHistory } = validatedData;

    // Check rate limiting
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const rateLimitConfig = user ? RATE_LIMITS.AUTH_CHAT : RATE_LIMITS.ANON_CHAT;
    const rateLimitResult = await RateLimiter.check('chat', rateLimitConfig);

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult) || NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    const transcriptContext = formatTranscriptForContext(transcript);
    const topicsContext = topics ? topics.map((t: Topic) =>
      `- ${t.title}: ${t.description || ''}`
    ).join('\n') : '';

    const chatHistoryContext = chatHistory?.map((msg: any) =>
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n\n') || '';

    const prompt = `<task>
<role>You are an expert AI assistant for video transcripts. You intelligently combine transcript context with general knowledge to provide comprehensive answers.</role>
<context>
<videoTopics>
${topicsContext || 'None provided'}
</videoTopics>
<conversationHistory><![CDATA[
${chatHistoryContext || 'No prior conversation'}
]]></conversationHistory>
</context>
<goal>Deliver concise, factual answers that combine video-specific information with relevant general knowledge when needed.</goal>
<instructions>
  <step name="Language Detection">
    <item>CRITICAL: Detect the language of the user's question and the transcript.</item>
    <item>If the user asks in Indonesian, respond in Indonesian.</item>
    <item>If the user asks in English, respond in English.</item>
    <item>If the transcript is in Indonesian, use Indonesian context naturally.</item>
    <item>Always match the user's language in your response.</item>
  </step>
  <step name="Assess Intent and Strategy">
    <item>Determine if the question is asking for: (a) video-specific facts, (b) conceptual/definitional understanding, or (c) general knowledge unrelated to the video.</item>
    <item>For video-specific facts: Search the transcript and cite with timestamps.</item>
    <item>For conceptual/definitional questions: Provide general knowledge explanation FIRST, then connect to video context if available with timestamps.</item>
    <item>For general knowledge unrelated to video: Answer directly without forcing transcript references.</item>
    <item>When a term or concept is mentioned in the video but not fully explained in the transcript, provide the general knowledge definition first, then cite what the video says about it.</item>
  </step>
  <step name="Using The Transcript">
    <item>When referencing the video, rely exclusively on the transcript for video-specific claims.</item>
    <item>Whenever you make a factual claim based on the transcript, append the exact supporting timestamp in brackets like [MM:SS] or [HH:MM:SS]. Never use numeric citation markers like [1].</item>
    <item>List the same timestamps in the timestamps array, zero-padded and in the order they appear. Provide no more than five unique timestamps.</item>
  </step>
  <step name="Combining General Knowledge with Transcript">
    <item>For conceptual questions, structure your answer as: [General definition/explanation] + [Video context with timestamps if available].</item>
    <item>Clearly indicate what comes from general knowledge vs what comes from the video.</item>
    <item>Use phrases like "In this video, [speaker] mentions..." or "According to the video..." when citing video content.</item>
    <item>If the transcript mentions a concept without explaining it, provide the explanation from general knowledge, then cite the video's mention with timestamp.</item>
  </step>
  <step name="AnswerFormatting">
    <item>Respond in the SAME LANGUAGE as the user's question.</item>
    <item>Respond in concise, complete sentences that are informative and contextual.</item>
    <item>For pure general knowledge answers (unrelated to video), return empty timestamps array.</item>
    <item>For hybrid answers (general knowledge + video context), include timestamps only for video-specific claims.</item>
  </step>
</instructions>
<validationChecklist>
  <item>Did you respond in the SAME LANGUAGE as the user's question?</item>
  <item>For conceptual questions, did you provide the definition/explanation even if not in transcript?</item>
  <item>If you cited the transcript, does every video-specific claim have a supporting timestamp in brackets?</item>
  <item>Are all timestamps valid moments within the transcript?</item>
  <item>Did you clearly distinguish between general knowledge and video content?</item>
</validationChecklist>
<outputFormat>Return strict JSON object: {"answer":"string","timestamps":["MM:SS"]}. No extra commentary. The "answer" field must be in the SAME LANGUAGE as the user's question.</outputFormat>
<transcript><![CDATA[
${transcriptContext}
]]></transcript>
<userQuestion><![CDATA[
${message}
]]></userQuestion>
</task>`;

    const maxOutputTokens = 65536;

    let response = '';

    try {
      response = await generateWithFallback(prompt, {
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: Math.min(1024, maxOutputTokens),
        },
        zodSchema: chatResponseSchema
      });

      console.log('=== GEMINI RAW RESPONSE ===');
      console.log('Response length:', response.length);
      console.log('Raw response:', response);
      console.log('=== END RAW RESPONSE ===');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        return NextResponse.json({
          content: "The AI service is currently at capacity. Please wait a moment and try again.",
          citations: [],
        });
      }
      return NextResponse.json({
        content: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
        citations: [],
      });
    }

    if (!response) {
      return NextResponse.json({
        content: "I couldn't generate a response. Please try rephrasing your question.",
        citations: [],
      });
    }

    let parsedResponse;
    try {
      console.log('=== PARSING JSON RESPONSE ===');
      console.log('Response to parse:', response);
      const parsedJson = JSON.parse(response);
      parsedResponse = chatResponseSchema.parse(parsedJson);
      console.log('Parsed response:', JSON.stringify(parsedResponse, null, 2));
      console.log('=== END PARSING ===');
    } catch (e) {
      console.log('=== JSON PARSING ERROR ===');
      console.log('Error:', e);
      console.log('Response that failed to parse:', response);
      console.log('=== END PARSING ERROR ===');
      const fallbackContent = stripCodeFences(response);
      if (fallbackContent) {
        try {
          const fallbackJson = JSON.parse(fallbackContent);
          parsedResponse = chatResponseSchema.parse(fallbackJson);
          console.log('Recovered response via fallback JSON parsing.');
        } catch (fallbackError) {
          console.log('Fallback JSON parsing failed:', fallbackError);
          const recovered = recoverPartialResponse(fallbackContent);
          if (recovered) {
            parsedResponse = chatResponseSchema.parse(recovered);
            console.log('Recovered response via partial extraction.');
          } else {
            console.log('Unable to recover partial response.');
            return NextResponse.json({
              content: "I couldn't generate a valid response. Please try again.",
              citations: [],
            });
          }
        }
      } else {
        const recovered = recoverPartialResponse(response);
        if (recovered) {
          parsedResponse = chatResponseSchema.parse(recovered);
          console.log('Recovered response via direct partial extraction.');
        } else {
          return NextResponse.json({
            content: "I couldn't generate a valid response. Please try again.",
            citations: [],
          });
        }
      }
    }

    const { answer, timestamps } = parsedResponse;

    console.log('=== EXTRACTED DATA ===');
    console.log('Answer:', answer);
    console.log('Timestamps:', timestamps);
    console.log('Timestamps is array:', Array.isArray(timestamps));
    console.log('=== END EXTRACTED DATA ===');

    if (!answer || typeof answer !== 'string') {
      console.log('=== VALIDATION FAILED ===');
      console.log('Answer exists:', !!answer);
      console.log('=== END VALIDATION FAILED ===');
      return NextResponse.json({
        content: "I found some information, but couldn't format it correctly.",
        citations: [],
      });
    }

    let normalizedTimestamps = Array.isArray(timestamps)
      ? normalizeTimestampSources(timestamps, { limit: 5 })
      : [];

    if (normalizedTimestamps.length === 0) {
      const extracted = extractTimestamps(answer);
      normalizedTimestamps = normalizeTimestampSources(
        extracted.map(item => item.text),
        { limit: 5 }
      );
    }

    console.log('Normalized timestamps:', normalizedTimestamps);

    const citationCandidates: Array<{
      timestamp: string;
      seconds: number;
      segment: TranscriptSegment;
      index: number;
    }> = [];

    const seenKeys = new Set<string>();

    for (const timestamp of normalizedTimestamps) {
      const seconds = parseTimestamp(timestamp);
      if (seconds === null) continue;

      const closest = findClosestSegment(transcript, seconds);
      if (!closest) continue;

      const key = `${closest.index}|${timestamp}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      citationCandidates.push({
        timestamp,
        seconds,
        segment: closest.segment,
        index: closest.index,
      });
    }

    citationCandidates.sort((a, b) => a.seconds - b.seconds);

    const citations: Omit<Citation, 'context'>[] = citationCandidates.map((candidate, idx) => ({
      number: idx + 1,
      text: candidate.segment.text,
      start: candidate.segment.start,
      end: candidate.segment.start + candidate.segment.duration,
      startSegmentIdx: candidate.index,
      endSegmentIdx: candidate.index,
      startCharOffset: 0,
      endCharOffset: candidate.segment.text.length,
    }));

    const processedAnswer = answer.trim();

    console.log('=== FINAL RESPONSE ===');
    console.log('Final answer:', processedAnswer);
    console.log('Final timestamps:', normalizedTimestamps);
    console.log('Final citations count:', citations.length);
    console.log('Final citations:', JSON.stringify(citations, null, 2));
    console.log('=== END FINAL RESPONSE ===');

    return NextResponse.json({ 
      content: processedAnswer,
      citations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}

// Apply security (rate limiting is handled internally in the route)
export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts and chat history
  allowedMethods: ['POST']
});
