import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, Topic, ChatMessage, Citation } from '@/lib/types';
import { buildTranscriptIndex, findTextInTranscript } from '@/lib/quote-matcher';
import { TIMESTAMP_REGEX, parseTimestamp } from '@/lib/timestamp-utils';
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
<role>You are an expert AI assistant who must answer using only the provided video transcript.</role>
<context>
<videoTopics>
${topicsContext || 'None provided'}
</videoTopics>
<conversationHistory><![CDATA[
${chatHistoryContext || 'No prior conversation'}
]]></conversationHistory>
</context>
<goal>Deliver a concise, factual answer that is fully supported by transcript evidence.</goal>
<instructions>
  <step name="Grounding">
    <item>Use the transcript as the sole source of truth.</item>
    <item>If the answer is missing, explicitly state that it is not in the transcript and return an empty quotes array.</item>
  </step>
  <step name="AnswerFormatting">
    <item>Respond in complete sentences, weaving in numbered citation markers like [1] immediately after the supported statement.</item>
    <item>The number of citation markers must match the number of quotes you provide.</item>
  </step>
  <step name="QuoteSelection">
    <item>Include only verbatim, character-for-character passages from the transcript.</item>
    <item>Select complete sentences that stand on their own and directly justify the cited claim.</item>
    <item>Avoid redundant or overlapping quotes.</item>
  </step>
</instructions>
<validationChecklist>
  <item>Does every factual statement in the answer have a matching citation?</item>
  <item>Are all quotes exact matches from the transcript with no edits?</item>
  <item>If information is absent, did you say so and leave quotes empty?</item>
</validationChecklist>
<outputFormat>Return strict JSON object: {"answer":"string","quotes":[{"text":"string"}]}. No extra commentary.</outputFormat>
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
      return NextResponse.json({
        content: "I couldn't generate a valid response. Please try again.",
        citations: [],
      });
    }

    const { answer, quotes } = parsedResponse;

    console.log('=== EXTRACTED DATA ===');
    console.log('Answer:', answer);
    console.log('Quotes:', quotes);
    console.log('Quotes is array:', Array.isArray(quotes));
    console.log('=== END EXTRACTED DATA ===');

    if (!answer || !quotes || !Array.isArray(quotes)) {
      console.log('=== VALIDATION FAILED ===');
      console.log('Answer exists:', !!answer);
      console.log('Quotes exists:', !!quotes);
      console.log('Quotes is array:', Array.isArray(quotes));
      console.log('=== END VALIDATION FAILED ===');
      return NextResponse.json({
        content: answer || "I found some information, but couldn't format it correctly.",
        citations: [],
      });
    }

    // Build transcript index for efficient quote matching
    const transcriptIndex = buildTranscriptIndex(transcript);
    const citations: Omit<Citation, 'context'>[] = [];

    // Process each quote to find its location in the transcript
    await Promise.all(quotes.map(async (quote: { text: string }, index: number) => {
      if (typeof quote.text !== 'string' || !quote.text.trim()) return;

      // First attempt with a stricter similarity threshold
      let match = findTextInTranscript(transcript, quote.text, transcriptIndex, {
        strategy: 'all',
        minSimilarity: 0.75,
      });

      // Fallback with more lenient settings if the first attempt fails
      if (!match) {
        match = findTextInTranscript(transcript, quote.text, transcriptIndex, {
          strategy: 'all',
          minSimilarity: 0.60, // Lower threshold to catch paraphrasing
          maxSegmentWindow: 40,  // Widen search window for longer quotes
        });
      }

      if (match) {
        const startSegment = transcript[match.startSegmentIdx];
        const endSegment = transcript[match.endSegmentIdx];
        citations.push({
          number: index + 1,
          text: quote.text,
          start: startSegment.start,
          end: endSegment.start + endSegment.duration,
          startSegmentIdx: match.startSegmentIdx,
          endSegmentIdx: match.endSegmentIdx,
          startCharOffset: match.startCharOffset,
          endCharOffset: match.endCharOffset,
        });
      }
    }));

    // Sort citations by number
    citations.sort((a, b) => a.number - b.number);

    // Post-process to convert raw timestamps in answer to proper citations
    let processedAnswer = answer;
    const additionalCitations: Omit<Citation, 'context'>[] = [];
    let nextCitationNumber = citations.length + 1;
    
    // Find all raw timestamps in the answer using a more comprehensive regex
    // This matches timestamps in various formats: [MM:SS], (MM:SS), MM:SS, [HH:MM:SS], etc.
    const timestampPatterns = [
      /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,  // [MM:SS] or [HH:MM:SS]
      /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g,  // (MM:SS) or (HH:MM:SS)
      /(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$|[,.])/g,  // Bare timestamps
    ];
    
    const timestampReplacements: Array<{ original: string; replacement: string; citation: Omit<Citation, 'context'> }> = [];
    
    for (const pattern of timestampPatterns) {
      let match;
      while ((match = pattern.exec(answer)) !== null) {
        const fullMatch = match[0];
        const timestampStr = match[1];
        const seconds = parseTimestamp(timestampStr);
        
        if (seconds !== null) {
          // Check if this timestamp is already covered by existing citations
          const alreadyCited = citations.some(c => 
            Math.abs(c.start - seconds) < 5 // Within 5 seconds
          );
          
          if (!alreadyCited) {
            // Find the closest segment in the transcript
            const closest = findClosestSegment(transcript, seconds);
            
            if (closest) {
              const citation: Omit<Citation, 'context'> = {
                number: nextCitationNumber,
                text: closest.segment.text,
                start: closest.segment.start,
                end: closest.segment.start + closest.segment.duration,
                startSegmentIdx: closest.index,
                endSegmentIdx: closest.index,
                startCharOffset: 0,
                endCharOffset: closest.segment.text.length,
              };
              
              timestampReplacements.push({
                original: fullMatch,
                replacement: fullMatch.replace(timestampStr, `[${nextCitationNumber}]`),
                citation
              });
              
              nextCitationNumber++;
            }
          }
        }
      }
    }
    
    // Apply replacements in reverse order to maintain string positions
    timestampReplacements.sort((a, b) => b.original.length - a.original.length);
    
    for (const { original, replacement, citation } of timestampReplacements) {
      // Only replace if not already a numbered citation
      if (!/\[\d+\]/.test(original)) {
        processedAnswer = processedAnswer.replace(original, replacement);
        additionalCitations.push(citation);
      }
    }
    
    // Combine original and additional citations
    const allCitations = [...citations, ...additionalCitations];
    allCitations.sort((a, b) => a.number - b.number);

    console.log('=== FINAL RESPONSE ===');
    console.log('Final answer:', processedAnswer);
    console.log('Final citations count:', allCitations.length);
    console.log('Final citations:', JSON.stringify(allCitations, null, 2));
    console.log('Raw timestamps found and converted:', additionalCitations.length);
    console.log('=== END FINAL RESPONSE ===');

    return NextResponse.json({ 
      content: processedAnswer,
      citations: allCitations,
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
