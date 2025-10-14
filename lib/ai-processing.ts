import { TranscriptSegment, Topic, VideoInfo } from '@/lib/types';
import {
  normalizeWhitespace,
  buildTranscriptIndex,
  findTextInTranscript,
  TranscriptIndex
} from '@/lib/quote-matcher';
import { generateWithFallback } from '@/lib/gemini-client';
import { topicGenerationSchema } from '@/lib/schemas';
import { z } from 'zod';

interface ParsedTopic {
  title: string;
  quote?: {
    timestamp: string;
    text: string;
  };
}

interface GenerateTopicsOptions {
  videoInfo?: Partial<VideoInfo>;
  chunkDurationSeconds?: number;
  chunkOverlapSeconds?: number;
  fastModel?: string;
  maxTopics?: number;
}

interface TranscriptChunk {
  id: string;
  start: number;
  end: number;
  segments: TranscriptSegment[];
}

interface CandidateTopic extends ParsedTopic {
  sourceChunkId: string;
  chunkStart: number;
  chunkEnd: number;
}

const DEFAULT_CHUNK_DURATION_SECONDS = 5 * 60; // 5 minutes
const DEFAULT_CHUNK_OVERLAP_SECONDS = 45;
const CHUNK_MAX_CANDIDATES = 2;

function parseTimestampRange(timestamp?: string): { start: number; end: number } | null {
  if (!timestamp) return null;
  const match = timestamp.match(/\[?(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\]?/);
  if (!match) return null;

  const start = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const end = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
  return { start, end };
}

function chunkTranscript(
  segments: TranscriptSegment[],
  chunkDurationSeconds: number,
  overlapSeconds: number
): TranscriptChunk[] {
  if (segments.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  const lastSegment = segments[segments.length - 1];
  const totalDuration = lastSegment.start + lastSegment.duration;

  const effectiveChunkDuration = Math.max(180, chunkDurationSeconds);
  const effectiveOverlap = Math.min(Math.max(overlapSeconds, 0), Math.floor(effectiveChunkDuration / 2));
  const step = Math.max(60, effectiveChunkDuration - effectiveOverlap);

  let windowStart = segments[0].start;
  let anchorIdx = 0;

  while (windowStart < totalDuration && anchorIdx < segments.length) {
    while (
      anchorIdx < segments.length &&
      segments[anchorIdx].start + segments[anchorIdx].duration <= windowStart
    ) {
      anchorIdx++;
    }

    if (anchorIdx >= segments.length) break;

    const chunkSegments: TranscriptSegment[] = [];
    let idx = anchorIdx;
    const windowEndTarget = windowStart + effectiveChunkDuration;
    let windowEnd = windowStart;

    while (idx < segments.length) {
      const segment = segments[idx];
      const segmentEnd = segment.start + segment.duration;

      if (segment.start > windowEndTarget && chunkSegments.length > 0) {
        break;
      }

      chunkSegments.push(segment);
      windowEnd = Math.max(windowEnd, segmentEnd);

      if (segmentEnd >= windowEndTarget && chunkSegments.length > 0) {
        break;
      }

      idx++;
    }

    if (chunkSegments.length === 0) {
      chunkSegments.push(segments[anchorIdx]);
    }

    const chunkStart = chunkSegments[0].start;
    const chunkEnd = chunkSegments[chunkSegments.length - 1].start +
      chunkSegments[chunkSegments.length - 1].duration;

    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      start: chunkStart,
      end: chunkEnd,
      segments: chunkSegments
    });

    windowStart = chunkStart + step;
  }

  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk) {
    const coverageGap = totalDuration - lastChunk.end;
    if (coverageGap > 5) {
      const tailStartTime = Math.max(segments[0].start, totalDuration - effectiveChunkDuration);
      const tailSegments = segments.filter(seg => seg.start + seg.duration >= tailStartTime);
      if (tailSegments.length > 0) {
        const tailEnd = tailSegments[tailSegments.length - 1].start +
          tailSegments[tailSegments.length - 1].duration;
        if (tailEnd > lastChunk.end + 1) {
          chunks.push({
            id: `chunk-${chunks.length + 1}`,
            start: tailSegments[0].start,
            end: tailEnd,
            segments: tailSegments
          });
        }
      }
    }
  }

  return chunks;
}

function dedupeCandidates(candidates: CandidateTopic[]): CandidateTopic[] {
  const seen = new Set<string>();
  const result: CandidateTopic[] = [];

  for (const candidate of candidates) {
    if (!candidate.quote?.timestamp || !candidate.quote.text) continue;
    const key = `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  // Preserve the original chunk traversal order instead of resorting candidates by time.
  return result;
}

function formatVideoInfoForPrompt(videoInfo?: Partial<VideoInfo>): string {
  if (!videoInfo) {
    return 'Unknown video title and speaker';
  }

  const parts: string[] = [];
  if (videoInfo.title) parts.push(`Title: ${videoInfo.title}`);
  if (videoInfo.author) parts.push(`Speaker: ${videoInfo.author}`);
  if (videoInfo.description) parts.push(`Description: ${videoInfo.description}`);

  return parts.length > 0 ? parts.join('\n') : 'Unknown video title and speaker';
}

function buildChunkPrompt(
  chunk: TranscriptChunk,
  maxCandidates: number,
  videoInfo?: Partial<VideoInfo>
): string {
  const transcript = formatTranscriptWithTimestamps(chunk.segments);
  const chunkWindow = `[${formatTime(chunk.start)}-${formatTime(chunk.end)}]`;
  const videoInfoBlock = formatVideoInfoForPrompt(videoInfo);

  return `<task>
<role>You are an expert content strategist reviewing a portion of a video transcript.</role>
<context>
${videoInfoBlock}
Chunk window: ${chunkWindow}
</context>
<goal>Identify up to ${maxCandidates} compelling highlight reel ideas that originate entirely within this transcript slice.</goal>
<instructions>
  <item>Only use content from this chunk. If nothing stands out, return an empty list.</item>
  <item>Each highlight must include a punchy, specific title (max 10 words) and a contiguous quote of roughly 45-75 seconds.</item>
  <item>Quote text must match the transcript exactly—no paraphrasing, ellipses, or stitching from multiple places.</item>
  <item>Use absolute timestamps in [MM:SS-MM:SS] format that match the transcript lines.</item>
  <item>Focus on contrarian insights, vivid stories, or data-backed arguments that could stand alone.</item>
</instructions>
<outputFormat>Return strict JSON with at most ${maxCandidates} entries matching this schema: [{"title":"string","quote":{"timestamp":"[MM:SS-MM:SS]","text":"exact transcript text"}}]</outputFormat>
<transcriptChunk><![CDATA[
${transcript}
]]></transcriptChunk>
</task>`;
}

function buildReducePrompt(
  candidates: CandidateTopic[],
  maxTopics: number,
  videoInfo?: Partial<VideoInfo>
): string {
  const videoInfoBlock = formatVideoInfoForPrompt(videoInfo);
  const candidateBlock = candidates.map((candidate, idx) => {
    const timestamp = candidate.quote?.timestamp ?? '[??:??-??:??]';
    const quoteText = candidate.quote?.text ?? '';
    const chunkWindow = `[${formatTime(candidate.chunkStart)}-${formatTime(candidate.chunkEnd)}]`;
    return `Candidate ${idx + 1}
Chunk window: ${chunkWindow}
Original title: ${candidate.title}
Quote timestamp: ${timestamp}
Quote text: ${quoteText}`;
  }).join('\n\n');

  return `<task>
<role>You are a senior editorial strategist assembling the final highlight reel lineup.</role>
<context>
${videoInfoBlock}
You have ${candidates.length} candidate quotes extracted from the transcript.
</context>
<goal>Select up to ${maxTopics} highlights that maximize diversity, insight, and narrative punch while reusing the provided quotes.</goal>
<instructions>
  <item>Review the candidates and choose the strongest, most distinct ideas across the entire video.</item>
  <item>If two candidates overlap, keep the better one.</item>
  <item>You may rewrite titles for clarity, but you must keep the quote text and timestamp as provided.</item>
  <item>Respond with strict JSON: [{"candidateIndex":number,"title":"string"}]. Indices are 1-based and reference the numbered candidates below.</item>
</instructions>
<candidates><![CDATA[
${candidateBlock}
]]></candidates>
</task>`;
}

function createReduceSelectionSchema(limit: number) {
  return z.array(
    z.object({
      candidateIndex: z.number().int().min(1),
      title: z.string().min(1).max(120)
    })
  ).max(limit);
}

function buildFallbackTopics(
  transcript: TranscriptSegment[],
  maxTopics: number,
  fullText: string
): ParsedTopic[] {
  if (transcript.length === 0) {
    if (!fullText) return [];
    return [{
      title: 'Full Video',
      quote: {
        timestamp: '[00:00-00:30]',
        text: fullText.substring(0, 200)
      }
    }];
  }

  const fallbackCount = Math.min(3, Math.max(1, maxTopics));
  const chunkSize = Math.ceil(transcript.length / fallbackCount);
  const fallbackTopics: ParsedTopic[] = [];

  for (let i = 0; i < fallbackCount && i * chunkSize < transcript.length; i++) {
    const startIdx = i * chunkSize;
    const endIdx = Math.min((i + 1) * chunkSize, transcript.length);
    const chunkSegments = transcript.slice(startIdx, endIdx);

    if (chunkSegments.length === 0) continue;

    const startTime = chunkSegments[0].start;
    const endSegment = chunkSegments[chunkSegments.length - 1];
    const endTime = endSegment.start + endSegment.duration;

    fallbackTopics.push({
      title: `Part ${i + 1}`,
      quote: {
        timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
        text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
      }
    });
  }

  if (fallbackTopics.length === 0 && fullText) {
    fallbackTopics.push({
      title: 'Full Video',
      quote: {
        timestamp: '[00:00-00:30]',
        text: fullText.substring(0, 200)
      }
    });
  }

  return fallbackTopics;
}

async function runSinglePassTopicGeneration(
  transcript: TranscriptSegment[],
  transcriptWithTimestamps: string,
  fullText: string,
  model: string
): Promise<ParsedTopic[]> {
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

  try {
    const response = await generateWithFallback(prompt, {
      preferredModel: model,
      generationConfig: {
        temperature: 0.7,
      },
      zodSchema: topicGenerationSchema
    });

    if (!response) {
      return [];
    }

    let parsedResponse: ParsedTopic[];
    try {
      parsedResponse = JSON.parse(response);
    } catch {
      return [{
        title: 'Full Video',
        quote: {
          timestamp: '[00:00-00:30]',
          text: fullText.substring(0, 200)
        }
      }];
    }

    if (!Array.isArray(parsedResponse)) {
      console.warn('Invalid response format from Gemini - expected array');
      return [];
    }

    return parsedResponse;
  } catch (error) {
    console.error('Single-pass topic generation failed:', error);
    return [];
  }
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
  _model: string = 'gemini-2.5-flash',
  options: GenerateTopicsOptions = {}
): Promise<Topic[]> {
  const {
    videoInfo,
    chunkDurationSeconds = DEFAULT_CHUNK_DURATION_SECONDS,
    chunkOverlapSeconds = DEFAULT_CHUNK_OVERLAP_SECONDS,
    fastModel = 'gemini-2.5-flash-lite',
    maxTopics = 5
  } = options;

  const requestedTopics = Math.max(1, Math.min(maxTopics, 5));
  const fullText = combineTranscript(transcript);
  const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);

  let topicsArray: ParsedTopic[] = [];
  let candidateTopics: CandidateTopic[] = [];

  if (transcript.length > 0) {
    try {
      const chunks = chunkTranscript(transcript, chunkDurationSeconds, chunkOverlapSeconds);
      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          const chunkPrompt = buildChunkPrompt(chunk, CHUNK_MAX_CANDIDATES, videoInfo);

          try {
            const response = await generateWithFallback(chunkPrompt, {
              preferredModel: fastModel,
              generationConfig: { temperature: 0.6 },
              zodSchema: topicGenerationSchema
            });

            if (!response) {
              return [] as CandidateTopic[];
            }

            let parsedChunk: ParsedTopic[];
            try {
              parsedChunk = JSON.parse(response);
            } catch (error) {
              console.warn(`Failed to parse chunk response (${chunk.id}):`, error);
              return [];
            }

            if (!Array.isArray(parsedChunk)) {
              return [];
            }

            return parsedChunk.slice(0, CHUNK_MAX_CANDIDATES)
              .filter(topic => topic?.quote?.timestamp && topic.quote.text)
              .map(topic => ({
                title: topic.title,
                quote: topic.quote,
                sourceChunkId: chunk.id,
                chunkStart: chunk.start,
                chunkEnd: chunk.end
              })) as CandidateTopic[];
          } catch (error) {
            console.error(`Chunk topic generation failed (${chunk.id}):`, error);
            return [] as CandidateTopic[];
          }
        })
      );

      candidateTopics = chunkResults.flat();
    } catch (error) {
      console.error('Error preparing chunked topic generation:', error);
    }
  }

  if (candidateTopics.length > 0) {
    candidateTopics = dedupeCandidates(candidateTopics);

    const reduceCandidates = candidateTopics;
    const reducePrompt = buildReducePrompt(reduceCandidates, requestedTopics, videoInfo);
    const selectionSchema = createReduceSelectionSchema(
      Math.min(requestedTopics, reduceCandidates.length)
    );

    let reduceSelections: Array<{ candidateIndex: number; title: string }> = [];

    try {
      const reduceResponse = await generateWithFallback(reducePrompt, {
        preferredModel: fastModel,
        generationConfig: { temperature: 0.4 },
        zodSchema: selectionSchema
      });

      if (reduceResponse) {
        try {
          reduceSelections = JSON.parse(reduceResponse);
        } catch (error) {
          console.warn('Failed to parse reduce response:', error);
        }
      }
    } catch (error) {
      console.error('Error reducing candidate topics:', error);
    }

    const usedIndices = new Set<number>();
    const reducedTopics: ParsedTopic[] = [];

    if (Array.isArray(reduceSelections)) {
      for (const selection of reduceSelections) {
        if (!selection) continue;
        const candidateIdx = selection.candidateIndex - 1;
        if (candidateIdx < 0 || candidateIdx >= reduceCandidates.length) continue;
        if (usedIndices.has(candidateIdx)) continue;

        const candidate = reduceCandidates[candidateIdx];
        if (!candidate.quote?.text || !candidate.quote.timestamp) continue;

        reducedTopics.push({
          title: selection.title?.trim() || candidate.title,
          quote: candidate.quote
        });
        usedIndices.add(candidateIdx);

        if (reducedTopics.length >= requestedTopics) {
          break;
        }
      }
    }

    if (reducedTopics.length === 0) {
      topicsArray = reduceCandidates.slice(0, requestedTopics).map(candidate => ({
        title: candidate.title,
        quote: candidate.quote
      }));
    } else {
      topicsArray = reducedTopics;
    }
  }

  if (topicsArray.length === 0) {
    const singlePassTopics = await runSinglePassTopicGeneration(
      transcript,
      transcriptWithTimestamps,
      fullText,
      fastModel
    );
    topicsArray = singlePassTopics;
  }

  if (topicsArray.length === 0) {
    topicsArray = buildFallbackTopics(transcript, requestedTopics, fullText);
  }

  topicsArray = topicsArray
    .filter(topic => topic?.quote?.timestamp && topic.quote.text)
    .slice(0, requestedTopics);

  if (topicsArray.length === 0) {
    return [];
  }

  const transcriptIndex = buildTranscriptIndex(transcript);

  const topicsWithSegments = await Promise.all(
    topicsArray.map(async (topic: ParsedTopic, index: number) => {
      const quotesArray = topic.quote ? [topic.quote] : [];
      const segments = await findExactQuotes(transcript, quotesArray, transcriptIndex);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

      return {
        id: `topic-${index}`,
        title: topic.title,
        duration: Math.round(totalDuration),
        segments,
        quote: topic.quote
      };
    })
  );

  const topics = topicsWithSegments.length > 0 ? topicsWithSegments :
    topicsArray.map((topic: ParsedTopic, index: number) => ({
      id: `topic-${index}`,
      title: topic.title,
      duration: 0,
      segments: [],
      quote: topic.quote || undefined
    }));

  topics.sort((a: any, b: any) => {
    const startA = a.segments.length > 0 ? a.segments[0].start : Infinity;
    const startB = b.segments.length > 0 ? b.segments[0].start : Infinity;
    return startA - startB;
  });

  return topics;
}
