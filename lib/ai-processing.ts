import { TranscriptSegment, Topic, TopicCandidate, VideoInfo, TopicGenerationMode } from '@/lib/types';
import {
  normalizeWhitespace,
  buildTranscriptIndex,
  findTextInTranscript,
  TranscriptIndex
} from '@/lib/quote-matcher';
import { generateWithFallback } from '@/lib/gemini-client';
import { topicGenerationSchema } from '@/lib/schemas';
import { parseTimestampRange } from '@/lib/timestamp-utils';
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
  theme?: string;
  excludeTopicKeys?: Set<string>;
  includeCandidatePool?: boolean;
  mode?: TopicGenerationMode;
  proModel?: string;
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
  videoInfo?: Partial<VideoInfo>,
  theme?: string
): string {
  const transcript = formatTranscriptWithTimestamps(chunk.segments);
  const chunkWindow = `[${formatTime(chunk.start)}-${formatTime(chunk.end)}]`;
  const videoInfoBlock = formatVideoInfoForPrompt(videoInfo);
  const themeInstruction = theme
    ? `  <item>Focus exclusively on material that clearly expresses the theme "${theme}". Skip anything unrelated.</item>\n`
    : '';

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
${themeInstruction}</instructions>
<outputFormat>Return strict JSON with at most ${maxCandidates} entries matching this schema: [{"title":"string","quote":{"timestamp":"[MM:SS-MM:SS]","text":"exact transcript text"}}]</outputFormat>
<transcriptChunk><![CDATA[
${transcript}
]]></transcriptChunk>
</task>`;
}

function buildReducePrompt(
  candidates: CandidateTopic[],
  maxTopics: number,
  videoInfo?: Partial<VideoInfo>,
  minTopics: number = 0,
  segmentLabel?: string
): string {
  const videoInfoBlock = formatVideoInfoForPrompt(videoInfo);
  const segmentContext = segmentLabel ? `Focus: ${segmentLabel} of the video.` : '';
  const selectionGuidance = minTopics > 0
    ? `Select between ${minTopics} and ${maxTopics} highlights when possible. If fewer than ${minTopics} candidates meet the quality bar, return the strongest available options.`
    : `Select up to ${maxTopics} highlights that maximize diversity, insight, and narrative punch while reusing the provided quotes.`;
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
${segmentContext}
</context>
<goal>Choose the strongest highlights for this segment of the video.</goal>
<instructions>
  <item>${selectionGuidance}</item>
  <item>Review the candidates and choose the strongest, most distinct ideas within this segment.</item>
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

async function reduceCandidateSubset(
  candidates: CandidateTopic[],
  options: {
    minTopics: number;
    maxTopics: number;
    fastModel: string;
    videoInfo?: Partial<VideoInfo>;
    segmentLabel?: string;
  }
): Promise<ParsedTopic[]> {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  const constrainedMax = Math.min(options.maxTopics, candidates.length);
  if (constrainedMax <= 0) {
    return [];
  }

  const constrainedMin = Math.min(options.minTopics, constrainedMax);
  const reducePrompt = buildReducePrompt(
    candidates,
    constrainedMax,
    options.videoInfo,
    constrainedMin,
    options.segmentLabel
  );

  const selectionSchema = createReduceSelectionSchema(constrainedMax);
  let reduceSelections: Array<{ candidateIndex: number; title: string }> = [];

  try {
    const reduceResponse = await generateWithFallback(reducePrompt, {
      preferredModel: options.fastModel,
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
    console.error(`Error reducing candidate topics (${options.segmentLabel || 'segment'}):`, error);
  }

  const usedIndices = new Set<number>();
  const reducedTopics: ParsedTopic[] = [];

  if (Array.isArray(reduceSelections)) {
    for (const selection of reduceSelections) {
      if (!selection) continue;
      const candidateIdx = selection.candidateIndex - 1;
      if (candidateIdx < 0 || candidateIdx >= candidates.length) continue;
      if (usedIndices.has(candidateIdx)) continue;

      const candidate = candidates[candidateIdx];
      if (!candidate.quote?.text || !candidate.quote.timestamp) continue;

      reducedTopics.push({
        title: selection.title?.trim() || candidate.title,
        quote: candidate.quote
      });
      usedIndices.add(candidateIdx);

      if (reducedTopics.length >= constrainedMax) {
        break;
      }
    }
  }

  if (reducedTopics.length === 0) {
    return candidates.slice(0, constrainedMax).map(candidate => ({
      title: candidate.title,
      quote: candidate.quote
    }));
  }

  return reducedTopics;
}

function buildFallbackTopics(
  transcript: TranscriptSegment[],
  maxTopics: number,
  fullText: string,
  theme?: string
): ParsedTopic[] {
  if (transcript.length === 0) {
    if (!fullText) return [];
    return [{
      title: theme ? `${theme} overview` : 'Full Video',
      quote: {
        timestamp: '[00:00-00:30]',
        text: fullText.substring(0, 200)
      }
    }];
  }

  const fallbackCount = Math.min(6, Math.max(1, maxTopics));
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
      title: theme ? `${theme} — part ${i + 1}` : `Part ${i + 1}`,
      quote: {
        timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
        text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
      }
    });
  }

  if (fallbackTopics.length === 0 && fullText) {
    fallbackTopics.push({
      title: theme ? `${theme} spotlight` : 'Full Video',
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
  model: string,
  theme?: string
): Promise<ParsedTopic[]> {
  const themeGuidance = theme
    ? `<themeAlignment>
  <criterion name="ThemeRelevance">Every highlight must directly reinforce the theme "${theme}". Discard compelling ideas if they are off-theme.</criterion>
</themeAlignment>`
    : '';

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
${themeGuidance}
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
    const timestampRange = quote.timestamp ? parseTimestampRange(quote.timestamp) : null;
    if (!timestampRange) return null;

    const { start: timestampStart, end: timestampEnd } = timestampRange;

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
      return {
        start: firstSegment.segment.start,
        end: lastSegment.segment.start + lastSegment.segment.duration,
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
): Promise<{ topics: Topic[]; candidates?: TopicCandidate[]; modelUsed: string }> {
  const {
    videoInfo,
    chunkDurationSeconds = DEFAULT_CHUNK_DURATION_SECONDS,
    chunkOverlapSeconds = DEFAULT_CHUNK_OVERLAP_SECONDS,
    fastModel = 'gemini-2.5-flash-lite',
    maxTopics = 5,
    theme,
    excludeTopicKeys,
    includeCandidatePool,
    mode = 'smart',
    proModel = 'gemini-2.5-flash'
  } = options;

  const requestedTopics = Math.max(1, Math.min(maxTopics, 5));
  const isSmartMode = mode === 'smart';
  const fullText = combineTranscript(transcript);
  const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);
  const videoDurationSeconds = transcript.length > 0
    ? transcript[transcript.length - 1].start + transcript[transcript.length - 1].duration
    : 0;
  const isShortVideo = videoDurationSeconds <= 30 * 60;
  const smartModeModel = isShortVideo ? 'gemini-2.5-flash' : proModel;

  let topicsArray: ParsedTopic[] = [];
  let candidateTopics: CandidateTopic[] = [];
  const excludedKeys = excludeTopicKeys ?? new Set<string>();
  let resolvedModel = isSmartMode ? smartModeModel : fastModel;

  if (isSmartMode) {
    const smartTopics = await runSinglePassTopicGeneration(
      transcript,
      transcriptWithTimestamps,
      fullText,
      smartModeModel,
      theme
    );

    topicsArray = smartTopics.filter(topic => {
      if (!topic.quote?.timestamp || !topic.quote.text) return false;
      const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
      return !excludedKeys.has(key);
    });

    if (topicsArray.length === 0) {
      // Fallback to fast pipeline if smart fails to produce topics
      resolvedModel = fastModel;
    }
  }

  if (!isSmartMode && isShortVideo && transcript.length > 0) {
    const fullTranscriptTopics = await runSinglePassTopicGeneration(
      transcript,
      transcriptWithTimestamps,
      fullText,
      fastModel,
      theme
    );
    const filteredFullTranscriptTopics = fullTranscriptTopics.filter(topic => {
      if (!topic.quote?.timestamp || !topic.quote.text) return false;
      const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
      return !excludedKeys.has(key);
    });
    if (filteredFullTranscriptTopics.length > 0) {
      topicsArray = filteredFullTranscriptTopics;
    }
  }

  let shouldRunFastPipeline = !isSmartMode || topicsArray.length === 0;
  if (!isSmartMode && isShortVideo && topicsArray.length > 0) {
    shouldRunFastPipeline = false;
  }

  if (shouldRunFastPipeline && transcript.length > 0) {
    try {
      const chunks = chunkTranscript(transcript, chunkDurationSeconds, chunkOverlapSeconds);
      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          const chunkPrompt = buildChunkPrompt(chunk, CHUNK_MAX_CANDIDATES, videoInfo, theme);

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
    if (excludedKeys.size > 0) {
      candidateTopics = candidateTopics.filter(candidate => {
        if (!candidate.quote?.timestamp || !candidate.quote.text) return false;
        const key = `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`;
        return !excludedKeys.has(key);
      });
    }

    const videoDuration = videoDurationSeconds;
    let firstSegmentCandidates: CandidateTopic[] = [];
    let secondSegmentCandidates: CandidateTopic[] = [];

    if (candidateTopics.length === 1) {
      firstSegmentCandidates = [...candidateTopics];
    } else if (videoDuration > 0) {
      const boundaryTime = videoDuration * 0.6; // First 3/5 of the video
      for (const candidate of candidateTopics) {
        if (candidate.chunkStart < boundaryTime) {
          firstSegmentCandidates.push(candidate);
        } else {
          secondSegmentCandidates.push(candidate);
        }
      }
    }

    if (firstSegmentCandidates.length === 0 && secondSegmentCandidates.length === 0) {
      firstSegmentCandidates = [...candidateTopics];
      secondSegmentCandidates = [];
    }

    if (firstSegmentCandidates.length === 0 || secondSegmentCandidates.length === 0) {
      const totalCandidates = candidateTopics.length;
      if (totalCandidates > 1) {
        const boundaryIndex = Math.max(
          1,
          Math.min(
            totalCandidates - 1,
            Math.floor((totalCandidates * 3) / 5)
          )
        );
        firstSegmentCandidates = candidateTopics.slice(0, boundaryIndex);
        secondSegmentCandidates = candidateTopics.slice(boundaryIndex);

        if (firstSegmentCandidates.length === 0 && secondSegmentCandidates.length > 0) {
          const pivot = Math.ceil(secondSegmentCandidates.length / 2);
          firstSegmentCandidates = secondSegmentCandidates.slice(0, pivot);
          secondSegmentCandidates = secondSegmentCandidates.slice(pivot);
        } else if (secondSegmentCandidates.length === 0 && firstSegmentCandidates.length > 1) {
          const pivot = Math.floor(firstSegmentCandidates.length / 2);
          secondSegmentCandidates = firstSegmentCandidates.slice(pivot);
          firstSegmentCandidates = firstSegmentCandidates.slice(0, pivot);
        }
      } else if (totalCandidates === 1) {
        firstSegmentCandidates = [...candidateTopics];
        secondSegmentCandidates = [];
      }
    }

    const firstTarget = Math.min(3, requestedTopics);
    const secondTarget = Math.min(2, Math.max(0, requestedTopics - firstTarget));

    const segmentConfigs = [
      {
        label: 'first 3/5 of the video',
        candidates: firstSegmentCandidates,
        maxTopics: firstTarget,
        minTopics: firstTarget
      },
      {
        label: 'final 2/5 of the video',
        candidates: secondSegmentCandidates,
        maxTopics: secondTarget,
        minTopics: secondTarget
      }
    ].filter(segment => segment.candidates.length > 0 && segment.maxTopics > 0);

    const selectionPromises = segmentConfigs.map(segment =>
      reduceCandidateSubset(segment.candidates, {
        minTopics: Math.max(1, segment.minTopics),
        maxTopics: segment.maxTopics,
        fastModel,
        videoInfo,
        segmentLabel: segment.label
      })
    );

    const selectionResults = await Promise.allSettled(selectionPromises);
    const combinedSelections: ParsedTopic[] = [];

    selectionResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        combinedSelections.push(...result.value);
      } else {
        console.error(
          `Topic reduction failed for ${segmentConfigs[idx]?.label ?? 'segment'}:`,
          result.reason
        );
      }
    });

    topicsArray = combinedSelections;

    if (topicsArray.length < requestedTopics) {
      const usedKeys = new Set(
        topicsArray
          .map(topic => topic.quote)
          .filter((quote): quote is { timestamp: string; text: string } => !!quote?.timestamp && !!quote.text)
          .map(quote => `${quote.timestamp}|${normalizeWhitespace(quote.text)}`)
      );
      for (const key of excludedKeys) {
        usedKeys.add(key);
      }

      for (const candidate of candidateTopics) {
        if (!candidate.quote?.timestamp || !candidate.quote.text) continue;
        const candidateKey = `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`;
        if (usedKeys.has(candidateKey)) continue;

        topicsArray.push({
          title: candidate.title,
          quote: candidate.quote
        });
        usedKeys.add(candidateKey);

        if (topicsArray.length >= requestedTopics) {
          break;
        }
      }
    }

    if (topicsArray.length === 0) {
      topicsArray = candidateTopics.slice(0, Math.min(requestedTopics, candidateTopics.length))
        .map(candidate => ({
          title: candidate.title,
          quote: candidate.quote
        }));
    }
  }

  if (topicsArray.length === 0) {
    const singlePassTopics = await runSinglePassTopicGeneration(
      transcript,
      transcriptWithTimestamps,
      fullText,
      isSmartMode ? smartModeModel : fastModel,
      theme
    );
    topicsArray = singlePassTopics.filter(topic => {
      if (!topic.quote?.timestamp || !topic.quote.text) return false;
      const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
      return !excludedKeys.has(key);
    });
  }

  if (topicsArray.length === 0) {
    const fallbackTopics = buildFallbackTopics(transcript, requestedTopics, fullText, theme);
    topicsArray = fallbackTopics.filter(topic => {
      if (!topic.quote?.timestamp || !topic.quote.text) return false;
      const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
      return !excludedKeys.has(key);
    }).slice(0, requestedTopics);
  }

  topicsArray = topicsArray
    .filter(topic => topic?.quote?.timestamp && topic.quote.text)
    .slice(0, requestedTopics);

  if (topicsArray.length === 0) {
    return {
      topics: [],
      candidates: includeCandidatePool ? [] : undefined,
      modelUsed: resolvedModel
    };
  }

  const transcriptIndex = buildTranscriptIndex(transcript);

  const topicsWithSegments = await Promise.all(
    topicsArray.map(async (topic: ParsedTopic, index: number) => {
      const quotesArray = topic.quote ? [topic.quote] : [];
      const segments = await findExactQuotes(transcript, quotesArray, transcriptIndex);
      const normalizedSegments = segments
        .filter(segment =>
          Number.isFinite(segment.start) &&
          Number.isFinite(segment.end) &&
          segment.end >= segment.start
        )
        .sort((a, b) => a.start - b.start);
      const totalDuration = normalizedSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

      return {
        id: `topic-${index}`,
        title: topic.title,
        duration: Math.round(totalDuration),
        segments: normalizedSegments,
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
    const startA = getTopicStartTime(a);
    const startB = getTopicStartTime(b);

    const hasStartA = Number.isFinite(startA);
    const hasStartB = Number.isFinite(startB);

    if (hasStartA && hasStartB) {
      return startA - startB;
    }

    if (hasStartA) {
      return -1;
    }

    if (hasStartB) {
      return 1;
    }

    return 0;
  });

  let candidates: TopicCandidate[] | undefined;
  if (includeCandidatePool) {
    const sourceCandidates = candidateTopics.length > 0 ? candidateTopics : [];
    const candidateMap = new Map<string, TopicCandidate>();
    for (const candidate of sourceCandidates) {
      if (!candidate.quote?.timestamp || !candidate.quote.text) continue;
      const key = `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`;
      if (candidateMap.has(key) || excludedKeys.has(key)) continue;
      candidateMap.set(key, {
        key,
        title: candidate.title,
        quote: {
          timestamp: candidate.quote.timestamp,
          text: candidate.quote.text
        }
      });
    }

    for (const topic of topics) {
      if (!topic.quote?.timestamp || !topic.quote.text) continue;
      const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
      if (candidateMap.has(key)) continue;
      candidateMap.set(key, {
        key,
        title: topic.title,
        quote: {
          timestamp: topic.quote.timestamp,
          text: topic.quote.text
        }
      });
    }

    candidates = Array.from(candidateMap.values());
  }

  if (topics.length === 0) {
    resolvedModel = isSmartMode ? smartModeModel : fastModel;
  }

  return { topics, candidates, modelUsed: resolvedModel };
}

function getTopicStartTime(topic: {
  segments: { start: number; end: number }[];
  quote?: { timestamp?: string } | null;
}): number {
  if (Array.isArray(topic.segments) && topic.segments.length > 0) {
    return topic.segments[0].start;
  }

  const rawTimestamp = topic.quote?.timestamp;
  if (!rawTimestamp) {
    return Infinity;
  }

  const cleaned = rawTimestamp.replace(/[\[\]]/g, '').trim();
  if (!cleaned) {
    return Infinity;
  }

  const parts = cleaned.split(/-|–|—| to /i);
  const startPart = parts[0]?.trim();
  if (!startPart) {
    return Infinity;
  }

  const timeSegments = startPart.split(':').map(part => Number(part));
  if (timeSegments.some(segment => Number.isNaN(segment))) {
    return Infinity;
  }

  if (timeSegments.length === 3) {
    const [hours, minutes, seconds] = timeSegments;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (timeSegments.length === 2) {
    const [minutes, seconds] = timeSegments;
    return minutes * 60 + seconds;
  }

  if (timeSegments.length === 1) {
    return timeSegments[0];
  }

  return Infinity;
}

function sanitizeThemeList(themes: string[]): string[] {
  const unique = new Set<string>();
  const cleaned: string[] = [];

  for (const theme of themes) {
    const trimmed = theme.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    cleaned.push(trimmed);
  }

  return cleaned;
}

const THEME_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "nor",
  "with",
  "without",
  "of",
  "on",
  "in",
  "into",
  "onto",
  "to",
  "from",
  "by",
  "about",
  "over",
  "under",
  "across",
  "between",
  "vs",
  "versus",
  "per",
  "via"
]);

function extractThemeTokens(theme: string): string[] {
  return theme
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/'s$/, ""))
    .map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
    .filter((token) => token.length > 0 && !THEME_STOP_WORDS.has(token));
}

function areThemesSimilar(aTokens: string[], bTokens: string[]): boolean {
  if (aTokens.length === 0 || bTokens.length === 0) {
    return false;
  }

  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let overlap = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      overlap += 1;
    }
  }

  if (overlap === 0) {
    return false;
  }

  const smallerSize = Math.min(setA.size, setB.size);
  const containment = overlap / smallerSize;
  const unionSize = setA.size + setB.size - overlap;
  const jaccard = overlap / unionSize;

  const lastTokenA = aTokens[aTokens.length - 1];
  const lastTokenB = bTokens[bTokens.length - 1];
  const shareSpecificLastToken =
    lastTokenA === lastTokenB &&
    lastTokenA.length > 3 &&
    !THEME_STOP_WORDS.has(lastTokenA);

  return containment >= 0.75 || jaccard >= 0.6 || shareSpecificLastToken;
}

function promoteDistinctThemes(themes: string[], primaryCount = 3): string[] {
  if (themes.length <= 1) {
    return themes;
  }

  type ThemeTokenInfo = {
    value: string;
    tokens: string[];
  };

  const themedTokens: ThemeTokenInfo[] = themes.map((theme) => ({
    value: theme,
    tokens: extractThemeTokens(theme),
  }));

  const selected: ThemeTokenInfo[] = [];
  const deferred: ThemeTokenInfo[] = [];

  for (const item of themedTokens) {
    if (selected.length < primaryCount) {
      const isSimilar = selected.some((sel) => areThemesSimilar(sel.tokens, item.tokens));
      if (!isSimilar) {
        selected.push(item);
        continue;
      }
    }

    deferred.push(item);
  }

  if (selected.length < primaryCount) {
    const needed = primaryCount - selected.length;
    selected.push(...deferred.splice(0, needed));
  }

  return [...selected, ...deferred].map((entry) => entry.value);
}

export async function generateThemesFromTranscript(
  transcript: TranscriptSegment[],
  videoInfo?: Partial<VideoInfo>,
  model: string = 'gemini-2.5-flash-lite'
): Promise<string[]> {
  if (!transcript || transcript.length === 0) {
    return [];
  }

  const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);
  const videoInfoBlock = formatVideoInfoForPrompt(videoInfo);

  const prompt = `## Persona
You are an expert content analyst and a specialist in semantic keyword extraction. Your goal is to distill complex information into its most essential conceptual components for easy discovery.

## Objective
Analyze the provided video transcript to identify and extract its core concepts. Generate a list of 5-7 keywords or short key phrases that precisely capture the main topics discussed without overlapping. These keywords will be used to help potential viewers quickly understand the video's specific focus and determine its relevance to their interests.

## Strict Constraints
1.  **Quantity:** Provide between 5 and 7 keywords/phrases.
2.  **Length:** Each keyword/phrase must be strictly between 1 and 3 words.
3.  **Format:** Output must be a simple, unnumbered bulleted list. Do not add any introductory or concluding sentences.
4.  **Distinctness:** Each keyword must capture a meaningfully different angle, stakeholder, problem, method, or takeaway. Do not repeat the same head noun or near-synonym across items.

## Guiding Principles
* **Specificity over Generality:** Keywords must be specific, tangible concepts.
* **Focus on 'What', not 'About':** The keywords should be the *concepts themselves*, not descriptions *about* the concepts.
* **Identify Nouns and Noun Phrases:** Prioritize key terms, techniques, arguments, or recurring ideas that form the backbone of the content.

## Distinctness Guardrails
* Cover different facets of the discussion (e.g., challenges, solutions, frameworks, stakeholders, outcomes).
* Avoid re-using the same head noun (e.g., "strategy") unless it refers to a substantively different domain.
* Skip synonyms or simple adjective swaps of earlier keywords; each entry should stand on its own.

## Examples of Good vs. Bad Keywords
* **Good:** \`Student motivation\` (Specific, concise concept)
* **Good:** \`Onboarding flow optimization\` (Specific, concise concept)
* **Bad:** \`Future of education\` (Too vague and generic)
* **Bad:** \`Selection effects and scalability issues in private education\` (Too long; violates the 3-word limit)

## Task
Now, apply these rules to the following video transcript.

${videoInfoBlock ? `${videoInfoBlock}\n\n` : ''}${transcriptWithTimestamps}`;

  try {
    const response = await generateWithFallback(prompt, {
      preferredModel: model,
      generationConfig: { temperature: 0.3 }
    });

    if (!response) {
      return [];
    }

    const lines = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => !!line);

    const bulletLines = lines.length > 0 && lines.some(line => /^[-*•]/.test(line))
      ? lines.filter(line => /^[-*•]/.test(line))
      : lines;

    const themes = bulletLines
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .filter(line => {
        const wordCount = line.split(/\s+/).length;
        return wordCount >= 1 && wordCount <= 3;
      });

    const sanitizedThemes = sanitizeThemeList(themes);
    const diversifiedThemes = promoteDistinctThemes(sanitizedThemes);
    return diversifiedThemes.slice(0, 10);
  } catch (error) {
    console.error('Theme generation failed:', error);
    return [];
  }
}
