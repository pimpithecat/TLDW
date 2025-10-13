import { TranscriptSegment, Topic } from '@/lib/types';
import {
  normalizeWhitespace,
  buildTranscriptIndex,
  findTextInTranscript,
  TranscriptIndex
} from '@/lib/quote-matcher';
import { generateWithFallback } from '@/lib/gemini-client';
import { topicGenerationSchema } from '@/lib/schemas';

interface ParsedTopic {
  title: string;
  quote?: {
    timestamp: string;
    text: string;
  };
}

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

async function findExactQuotes(
  transcript: TranscriptSegment[],
  quotes: Array<{ timestamp: string; text: string }>,
  index: TranscriptIndex
): Promise<{
  start: number;
  end: number;
  text: string;
  startSegmentIdx?: number;
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  hasCompleteSentences?: boolean;
  confidence?: number;
}[]> {
  // Process quotes in parallel for better performance
  const quotePromises = quotes.map(async (quote) => {
    // Parse timestamp if provided
    const timestampMatch = quote.timestamp?.match(/\[?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]?/);
    if (!timestampMatch) return null;

    const [startMin, startSec] = timestampMatch[1].split(':').map(Number);
    const [endMin, endSec] = timestampMatch[2].split(':').map(Number);
    const timestampStart = startMin * 60 + startSec;
    const timestampEnd = endMin * 60 + endSec;

    // Use the exact text from the quote
    const quoteText = quote.text.trim();
    if (!quoteText) return null;

    // Try to find text match using optimized strategies
    const match = findTextInTranscript(transcript, quoteText, index, {
      strategy: 'all',
      minSimilarity: 0.80,
      maxSegmentWindow: 20
    });

    if (match) {
      // Get the actual timestamps from the segments
      const startSegment = transcript[match.startSegmentIdx];
      const endSegment = transcript[match.endSegmentIdx];

      return {
        start: startSegment.start,
        end: endSegment.start + endSegment.duration,
        text: quoteText,
        startSegmentIdx: match.startSegmentIdx,
        endSegmentIdx: match.endSegmentIdx,
        startCharOffset: match.startCharOffset,
        endCharOffset: match.endCharOffset,
        hasCompleteSentences: match.matchStrategy !== 'fuzzy-ngram',
        confidence: match.confidence
      };
    } else {
      // Check if normalized version exists
      const quoteNormalized = normalizeWhitespace(quoteText);
      const transcriptNormalized = index.normalizedText;

      // Find segments within the timestamp range
      const segmentsInRange: { idx: number; segment: TranscriptSegment }[] = [];
      for (let i = 0; i < transcript.length; i++) {
        const segment = transcript[i];
        const segmentEnd = segment.start + segment.duration;

        // Include segments that overlap with timestamp range
        if (segment.start <= timestampEnd && segmentEnd >= timestampStart) {
          segmentsInRange.push({ idx: i, segment });
        }
      }

      if (segmentsInRange.length === 0) {
        return null;
      }

      // Try to find match within the timestamp range segments
      const startSearchIdx = segmentsInRange[0].idx;
      const endSearchIdx = segmentsInRange[segmentsInRange.length - 1].idx;

      // Search within a constrained range with more lenient matching
      const rangeMatch = findTextInTranscript(transcript, quoteText, index, {
        startIdx: Math.max(0, startSearchIdx - 2),
        strategy: 'all',
        minSimilarity: 0.75, // More lenient for timestamp range
        maxSegmentWindow: Math.min(20, endSearchIdx - startSearchIdx + 5)
      });

      if (rangeMatch && rangeMatch.startSegmentIdx <= endSearchIdx + 2) {
        const startSegment = transcript[rangeMatch.startSegmentIdx];
        const endSegment = transcript[rangeMatch.endSegmentIdx];

        return {
          start: startSegment.start,
          end: endSegment.start + endSegment.duration,
          text: quoteText,
          startSegmentIdx: rangeMatch.startSegmentIdx,
          endSegmentIdx: rangeMatch.endSegmentIdx,
          startCharOffset: rangeMatch.startCharOffset,
          endCharOffset: rangeMatch.endCharOffset,
          hasCompleteSentences: rangeMatch.matchStrategy !== 'fuzzy-ngram',
          confidence: rangeMatch.confidence
        };
      }

      // Final fallback: Use timestamp range
      const firstSegment = segmentsInRange[0];
      const lastSegment = segmentsInRange[segmentsInRange.length - 1];
      const joinedText = segmentsInRange.map(s => s.segment.text).join(' ');

      return {
        start: firstSegment.segment.start,
        end: lastSegment.segment.start + lastSegment.segment.duration,
        text: joinedText, // Use the actual joined text from segments
        startSegmentIdx: firstSegment.idx,
        endSegmentIdx: lastSegment.idx,
        startCharOffset: 0,
        endCharOffset: lastSegment.segment.text.length,
        hasCompleteSentences: false,
        confidence: 0.5 // Low confidence for fallback
      };
    }

    return null; // Quote not found
  });

  const results = await Promise.all(quotePromises);
  return results.filter(r => r !== null) as any[];
}

/**
 * Generate highlight reel topics from a video transcript using AI
 * @param transcript The video transcript segments
 * @param model The AI model to use (default: gemini-2.5-flash)
 * @returns Array of topics with segments and quotes
 */
export async function generateTopicsFromTranscript(
  transcript: TranscriptSegment[],
  model: string = 'gemini-2.5-flash'
): Promise<Topic[]> {
  const fullText = combineTranscript(transcript);
  const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);

  const prompt = `<task>
<role>You are an expert content strategist.</role>
<goal>Analyze the provided video transcript and description to create up to five distinct highlight reels that let a busy, intelligent viewer absorb the video's most valuable insights in minutes.</goal>
<audience>The audience is forward-thinking and curious. They have a short attention span and expect contrarian insights, actionable mental models, and bold predictions rather than generic advice.</audience>
<instructions>
  <step name="IdentifyThemes">
    <description>Analyze the entire transcript to surface up to five high-value, thought-provoking themes.</description>
    <themeCriteria>
      <criterion name="Insightful">Challenge a common assumption or reframe a known concept.</criterion>
      <criterion name="Specific">Avoid vague or catch-all wording.</criterion>
      <criterion name="Format">Write each title as a complete sentence or question.</criterion>
      <criterion name="LengthLimit">Keep titles to a maximum of 10 words.</criterion>
      <criterion name="Synthesized">Connect ideas that span multiple moments in the talk.</criterion>
    </themeCriteria>
  </step>
  <step name="SelectPassage">
    <description>For each theme, pick the single most representative passage that powerfully illustrates the core idea.</description>
    <passageCriteria>
      <criterion name="DirectQuotes">Return verbatim transcript sentences only—no summaries, paraphrasing, or ellipses.</criterion>
      <criterion name="SelfContained">Ensure the passage stands alone. If earlier context is required, expand the selection to include it.</criterion>
      <criterion name="HighSignal">Prefer memorable stories, bold predictions, data points, specific examples, or contrarian thinking.</criterion>
      <criterion name="NoFluff">Exclude unrelated tangents or filler.</criterion>
      <criterion name="Duration" targetSeconds="60">Choose a contiguous passage around 60 seconds long (aim for 45-75 seconds) so the highlight provides full context.</criterion>
      <criterion name="MostImpactful">Select the single quote that best encapsulates the entire theme by itself.</criterion>
    </passageCriteria>
  </step>
</instructions>
<qualityControl>
  <distinctThemes>Each highlight reel title must represent a clearly distinct idea.</distinctThemes>
  <valueOverQuantity>If only three or four themes meet the quality bar, return that smaller number rather than adding generic options.</valueOverQuantity>
  <completenessCheck>Verify each passage contains a complete thought that can stand alone; extend the timestamp range if necessary.</completenessCheck>
</qualityControl>
<outputFormat>Respond with strict JSON that matches this schema: [{"title":"string","quote":{"timestamp":"[MM:SS-MM:SS]","text":"exact quoted text"}}]. Do not include XML, markdown, or commentary outside the JSON.</outputFormat>
<quoteRequirements>The "text" field must match the transcript exactly with original wording.</quoteRequirements>
<transcript><![CDATA[
${transcriptWithTimestamps}
]]></transcript>
</task>`;

  const response = await generateWithFallback(prompt, {
    preferredModel: model,
    generationConfig: {
      temperature: 0.7,
    },
    zodSchema: topicGenerationSchema
  });

  if (!response) {
    throw new Error('No response from Gemini');
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(response);
  } catch (parseError) {
    parsedResponse = [{
      title: "Full Video",
      quote: {
        timestamp: "[00:00-00:30]",
        text: fullText.substring(0, 200)
      }
    }];
  }

  if (!Array.isArray(parsedResponse)) {
    throw new Error('Invalid response format from Gemini - expected array');
  }

  let topicsArray = parsedResponse;

  // If we got an empty array, create a basic structure
  if (topicsArray.length === 0) {
    // Create basic topics based on transcript chunks
    const chunkSize = Math.ceil(transcript.length / 3);
    topicsArray = [];

    for (let i = 0; i < 3 && i * chunkSize < transcript.length; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min((i + 1) * chunkSize, transcript.length);
      const chunkSegments = transcript.slice(startIdx, endIdx);

      if (chunkSegments.length > 0) {
        const startTime = chunkSegments[0].start;
        const endTime = chunkSegments[chunkSegments.length - 1].start + chunkSegments[chunkSegments.length - 1].duration;

        topicsArray.push({
          title: `Part ${i + 1}`,
          quote: {
            timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
            text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
          }
        });
      }
    }
  }

  // Pre-build transcript index once for all quotes
  const transcriptIndex = buildTranscriptIndex(transcript);

  // Generate topics with segments from quotes (parallel processing)
  const topicsWithSegments = await Promise.all(
    topicsArray.map(async (topic: ParsedTopic, index: number) => {
      // Pass the quote to findExactQuotes (as an array for compatibility)
      const quotesArray = topic.quote ? [topic.quote] : [];

      // Find the exact segments for these quotes (now async with parallel processing)
      const segments = await findExactQuotes(transcript, quotesArray, transcriptIndex);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

      return {
        id: `topic-${index}`,
        title: topic.title,
        duration: Math.round(totalDuration),
        segments: segments,
        quote: topic.quote // Store original quote for display
      };
    })
  );

  // Keep all topics, even those without segments (they can still be displayed)
  const topics = topicsWithSegments.length > 0 ? topicsWithSegments :
    topicsArray.map((topic: ParsedTopic, index: number) => ({
      id: `topic-${index}`,
      title: topic.title,
      duration: 0,
      segments: [],
      quote: topic.quote || undefined
    }));

  // Sort topics chronologically by their first segment's start time
  topics.sort((a: any, b: any) => {
    const startA = a.segments.length > 0 ? a.segments[0].start : Infinity;
    const startB = b.segments.length > 0 ? b.segments[0].start : Infinity;
    return startA - startB;
  });

  return topics;
}