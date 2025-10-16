import { TranscriptSegment } from '@/lib/types';

// Configuration constants for quote matching
const QUOTE_MATCH_CONFIG = {
  FUZZY_MATCH_THRESHOLD: 0.85,
  MIN_FUZZY_SCORE: 0.7,
  N_GRAM_SIZE: 3,
  MIN_N_GRAM_OVERLAP: 0.5,
  SEGMENT_MERGE_GAP: 5, // seconds
  MIN_CONTEXT_DURATION: 15, // seconds
  MAX_CONTEXT_DURATION: 30, // seconds
  CONTEXT_EXTENSION: 5, // seconds to add before/after
} as const;

const PUNCTUATION_REGEX = /[.,?"'!—…–]/;
const WHITESPACE_REGEX = /\s/;

// Text normalization utilities
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

interface NormalizedIndexEntry {
  segmentIdx: number;
  charOffset: number;
  isBoundary?: boolean;
  nextSegmentIdx?: number;
}

function normalizeTextAndMap(text: string): { normalized: string; map: number[] } {
  const normalizedChars: string[] = [];
  const charMap: number[] = [];
  let pendingSpace = false;
  let pendingSpaceIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const rawChar = text[i];
    if (WHITESPACE_REGEX.test(rawChar)) {
      if (normalizedChars.length === 0) continue; // skip leading whitespace entirely
      if (!pendingSpace) {
        pendingSpace = true;
        pendingSpaceIndex = i;
      }
      continue;
    }

    const lowerChar = rawChar.toLowerCase();
    if (PUNCTUATION_REGEX.test(lowerChar)) {
      continue;
    }

    if (pendingSpace) {
      normalizedChars.push(' ');
      charMap.push(pendingSpaceIndex);
      pendingSpace = false;
      pendingSpaceIndex = -1;
    }

    normalizedChars.push(lowerChar);
    charMap.push(i);
  }

  if (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === ' ') {
    normalizedChars.pop();
    charMap.pop();
  }

  return {
    normalized: normalizedChars.join(''),
    map: charMap
  };
}

export function normalizeForMatching(text: string): string {
  return normalizeTextAndMap(text).normalized;
}

// Fast n-gram based similarity (0-1)
export function calculateNgramSimilarity(str1: string, str2: string): number {
  if (str1.length === 0 || str2.length === 0) return 0;
  
  const ngrams1 = new Set<string>();
  const ngrams2 = new Set<string>();
  
  // Generate 3-grams
  const clean1 = str1.replace(/\s+/g, '');
  const clean2 = str2.replace(/\s+/g, '');
  
  for (let i = 0; i <= clean1.length - 3; i++) {
    ngrams1.add(clean1.substring(i, i + 3));
  }
  
  for (let i = 0; i <= clean2.length - 3; i++) {
    ngrams2.add(clean2.substring(i, i + 3));
  }
  
  if (ngrams1.size === 0 || ngrams2.size === 0) {
    // Fallback to simple substring check for very short strings
    return clean1.includes(clean2) || clean2.includes(clean1) ? 0.8 : 0;
  }
  
  // Calculate Jaccard similarity
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) intersection++;
  }
  
  const union = ngrams1.size + ngrams2.size - intersection;
  return intersection / union;
}

// Boyer-Moore-Horspool substring search
export function boyerMooreSearch(text: string, pattern: string): number {
  if (pattern.length === 0) return 0;
  if (pattern.length > text.length) return -1;
  
  // Build bad character table
  const badChar = new Map<string, number>();
  for (let i = 0; i < pattern.length - 1; i++) {
    badChar.set(pattern[i], pattern.length - 1 - i);
  }
  
  let i = pattern.length - 1;
  while (i < text.length) {
    let j = pattern.length - 1;
    let k = i;
    while (j >= 0 && k >= 0 && text[k] === pattern[j]) {
      if (j === 0) return k;
      k--;
      j--;
    }
    const skip = (i < text.length && badChar.has(text[i])) 
      ? badChar.get(text[i])! 
      : pattern.length;
    i += skip;
  }
  
  return -1;
}

// Build a comprehensive index of the transcript
export interface TranscriptIndex {
  fullTextSpace: string;
  fullTextNewline: string;
  normalizedText: string;
  segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
    normalizedText: string;
    normalizedStartPos: number;
    normalizedEndPos: number;
  }>;
  wordIndex: Map<string, number[]>; // word -> [positions]
  ngramIndex: Map<string, Set<number>>; // 3-gram -> segment indices
  normalizedIndexMap: NormalizedIndexEntry[];
}

export function buildTranscriptIndex(transcript: TranscriptSegment[]): TranscriptIndex {
  const segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
    normalizedText: string;
    normalizedStartPos: number;
    normalizedEndPos: number;
  }> = [];
  
  let fullTextSpace = '';
  let fullTextNewline = '';
  let normalizedText = '';
  const wordIndex = new Map<string, number[]>();
  const ngramIndex = new Map<string, Set<number>>();
  const normalizedIndexMap: NormalizedIndexEntry[] = [];
  
  transcript.forEach((segment, idx) => {
    if (idx > 0) {
      fullTextSpace += ' ';
      fullTextNewline += '\n';
      normalizedText += ' ';
      normalizedIndexMap.push({
        segmentIdx: idx - 1,
        charOffset: transcript[idx - 1]?.text.length ?? 0,
        isBoundary: true,
        nextSegmentIdx: idx
      });
    }
    
    const segmentStartPos = fullTextSpace.length;
    const normalizedStartPos = normalizedText.length;
    const segmentNormalizedData = normalizeTextAndMap(segment.text);
    const segmentNormalized = segmentNormalizedData.normalized;
    
    fullTextSpace += segment.text;
    fullTextNewline += segment.text;
    normalizedText += segmentNormalized;
    
    for (let charIdx = 0; charIdx < segmentNormalized.length; charIdx++) {
      normalizedIndexMap.push({
        segmentIdx: idx,
        charOffset: segmentNormalizedData.map[charIdx]
      });
    }
    
    // Build word index for this segment
    const words = segmentNormalized.split(/\s+/);
    words.forEach((word) => {
      if (word.length > 2) {
        const positions = wordIndex.get(word) || [];
        positions.push(idx);
        wordIndex.set(word, positions);
      }
    });
    
    // Build n-gram index (3-grams)
    const cleanText = segmentNormalized.replace(/\s+/g, '');
    for (let i = 0; i <= cleanText.length - 3; i++) {
      const ngram = cleanText.substring(i, i + 3);
      if (!ngramIndex.has(ngram)) {
        ngramIndex.set(ngram, new Set());
      }
      ngramIndex.get(ngram)!.add(idx);
    }
    
    const boundary = {
      segmentIdx: idx,
      startPos: segmentStartPos,
      endPos: fullTextSpace.length,
      text: segment.text,
      normalizedText: segmentNormalized,
      normalizedStartPos,
      normalizedEndPos: normalizedText.length
    };
    segmentBoundaries.push(boundary);
  });
  
  return {
    fullTextSpace,
    fullTextNewline,
    normalizedText,
    segmentBoundaries,
    wordIndex,
    ngramIndex,
    normalizedIndexMap
  };
}

interface RefinedMatchResult {
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
  similarity: number;
}

// After n-gram window selection, re-run a localized search over the normalized transcript to
// pinpoint the best-matching substring. This keeps the fast fuzzy search but returns precise offsets.
function refineMatchInWindow(
  index: TranscriptIndex,
  startSegmentIdx: number,
  endSegmentIdx: number,
  targetText: string,
  minimumScore = 0.6
): RefinedMatchResult | null {
  if (!Number.isFinite(startSegmentIdx) || !Number.isFinite(endSegmentIdx)) {
    return null;
  }

  if (startSegmentIdx < 0 || endSegmentIdx < startSegmentIdx || endSegmentIdx >= index.segmentBoundaries.length) {
    return null;
  }

  const targetNormalized = normalizeForMatching(targetText);
  const targetLen = targetNormalized.length;
  if (targetLen === 0) {
    return null;
  }

  const startBoundary = index.segmentBoundaries[startSegmentIdx];
  const endBoundary = index.segmentBoundaries[endSegmentIdx];
  if (!startBoundary || !endBoundary) {
    return null;
  }

  const windowStartNorm = startBoundary.normalizedStartPos;
  const windowEndNorm = endBoundary.normalizedEndPos;
  if (windowEndNorm <= windowStartNorm) {
    return null;
  }

  const normalizedSlice = index.normalizedText.slice(windowStartNorm, windowEndNorm);
  if (normalizedSlice.length === 0) {
    return null;
  }

  const sliceLength = normalizedSlice.length;

  const candidateLengths = new Set<number>();
  candidateLengths.add(Math.min(targetLen, sliceLength));
  const tolerance = Math.max(2, Math.floor(targetLen * 0.3));
  for (let offset = 1; offset <= tolerance; offset++) {
    const shorter = targetLen - offset;
    const longer = targetLen + offset;
    if (shorter >= 2) candidateLengths.add(Math.min(shorter, sliceLength));
    if (longer <= sliceLength) candidateLengths.add(longer);
  }
  candidateLengths.add(Math.min(sliceLength, targetLen + tolerance));

  const lengths = Array.from(candidateLengths)
    .filter(len => len > 0 && len <= sliceLength)
    .sort((a, b) => a - b);

  let bestScore = 0;
  let bestSimilarity = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (let start = 0; start < sliceLength; start++) {
    for (const len of lengths) {
      const end = start + len;
      if (end > sliceLength) continue;
      const candidate = normalizedSlice.slice(start, end);
      if (candidate.length === 0) continue;

      const similarity = calculateNgramSimilarity(targetNormalized, candidate);
      if (similarity < minimumScore) continue;

      const lengthPenalty = 1 - Math.min(Math.abs(len - targetLen) / Math.max(targetLen, 1), 1);
      const compositeScore = similarity * 0.85 + lengthPenalty * 0.15;

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        bestSimilarity = similarity;
        bestStart = start;
        bestEnd = end;
        if (bestSimilarity >= 0.99) break;
      }
    }
  }

  if (bestStart === -1 || bestEnd === -1) {
    return null;
  }

  const globalStartIdx = windowStartNorm + bestStart;
  const globalEndIdx = windowStartNorm + bestEnd - 1;
  const startEntry = index.normalizedIndexMap[globalStartIdx];
  const endEntry = index.normalizedIndexMap[globalEndIdx];
  if (!startEntry || !endEntry) {
    return null;
  }

  let refinedStartSegment = startEntry.segmentIdx;
  let refinedStartOffset = startEntry.charOffset;
  if (startEntry.isBoundary && startEntry.nextSegmentIdx !== undefined) {
    refinedStartSegment = startEntry.nextSegmentIdx;
    refinedStartOffset = 0;
  }

  let refinedEndSegment = endEntry.segmentIdx;
  let refinedEndOffset = endEntry.charOffset + 1;
  if (endEntry.isBoundary) {
    refinedEndOffset = index.segmentBoundaries[refinedEndSegment]?.text.length ?? refinedEndOffset;
  } else {
    const endSegmentTextLength = index.segmentBoundaries[refinedEndSegment]?.text.length ?? refinedEndOffset;
    refinedEndOffset = Math.min(endSegmentTextLength, refinedEndOffset);
  }

  if (refinedEndSegment < refinedStartSegment) {
    return null;
  }

  const startSegmentTextLength = index.segmentBoundaries[refinedStartSegment]?.text.length ?? 0;
  refinedStartOffset = Math.max(0, Math.min(startSegmentTextLength, refinedStartOffset));

  if (refinedEndSegment === refinedStartSegment) {
    refinedEndOffset = Math.max(refinedStartOffset + 1, refinedEndOffset);
  }

  return {
    startSegmentIdx: refinedStartSegment,
    endSegmentIdx: refinedEndSegment,
    startCharOffset: refinedStartOffset,
    endCharOffset: refinedEndOffset,
    similarity: bestSimilarity
  };
}

// Optimized text matching with intelligent strategy selection
export function findTextInTranscript(
  transcript: TranscriptSegment[],
  targetText: string,
  index: TranscriptIndex,
  options: {
    startIdx?: number;
    strategy?: 'exact' | 'normalized' | 'fuzzy' | 'all';
    minSimilarity?: number;
    maxSegmentWindow?: number;
  } = {}
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
  matchStrategy: string;
  similarity: number;
  confidence: number;
} | null {
  const {
    startIdx = 0,
    strategy = 'all',
    minSimilarity = QUOTE_MATCH_CONFIG.FUZZY_MATCH_THRESHOLD,
    maxSegmentWindow = 30
  } = options;
  
  // Quick exact match using Boyer-Moore
  const exactMatch = boyerMooreSearch(index.fullTextSpace, targetText);
  if (exactMatch !== -1) {
    const result = mapMatchToSegments(exactMatch, targetText.length, index);
    if (result) {
      return {
        ...result,
        matchStrategy: 'exact',
        similarity: 1.0,
        confidence: 1.0
      };
    }
  }
  
  // Try normalized match
  const whitespaceNormalizedTarget = normalizeWhitespace(targetText);
  const normalizedMatch = boyerMooreSearch(index.normalizedText, whitespaceNormalizedTarget);
  if (normalizedMatch !== -1) {
    // Map back to original segments
    const result = mapNormalizedMatchToSegments(
      normalizedMatch,
      whitespaceNormalizedTarget,
      index,
      targetText
    );
    if (result) {
      return {
        ...result,
        matchStrategy: 'normalized',
        similarity: 0.95,
        confidence: 0.95
      };
    }
  }
  
  // Use word index for intelligent fuzzy matching
  const normalizedTarget = normalizeForMatching(targetText);
  const targetWords = normalizedTarget.split(/\s+/).filter(w => w.length > 2);
  let fallbackMatch: {
    startSegmentIdx: number;
    endSegmentIdx: number;
    similarity: number;
    confidence: number;
  } | null = null;
  if (targetWords.length > 0) {
    // Find segments containing the most target words
    const segmentScores = new Map<number, number>();
    
    for (const word of targetWords) {
      const segments = index.wordIndex.get(word) || [];
      for (const segIdx of segments) {
        if (segIdx >= startIdx) {
          segmentScores.set(segIdx, (segmentScores.get(segIdx) || 0) + 1);
        }
      }
    }
    
    // Get top scoring segments
    const scoredSegments = Array.from(segmentScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15); // Check top 15 candidates
    
    for (const [candidateIdx, score] of scoredSegments) {
      // Build a window around high-scoring segment
      const windowStart = Math.max(0, candidateIdx - 2);
      const windowEnd = Math.min(transcript.length - 1, candidateIdx + maxSegmentWindow);
      
      let combinedText = '';
      for (let i = windowStart; i <= windowEnd; i++) {
        if (i > windowStart) combinedText += ' ';
        combinedText += transcript[i].text;
        
        const normalizedCombined = normalizeForMatching(combinedText);
        const similarity = calculateNgramSimilarity(normalizedTarget, normalizedCombined);
        
        if (similarity >= minSimilarity) {
          const refined = refineMatchInWindow(index, windowStart, i, targetText, Math.min(similarity, minSimilarity));
          if (refined) {
            const wordCoverage = score / Math.max(targetWords.length, 1);
            const confidence = Math.max(refined.similarity, wordCoverage);
            return {
              found: true,
              startSegmentIdx: refined.startSegmentIdx,
              endSegmentIdx: refined.endSegmentIdx,
              startCharOffset: refined.startCharOffset,
              endCharOffset: refined.endCharOffset,
              matchStrategy: 'fuzzy-ngram',
              similarity: refined.similarity,
              confidence: Math.min(1, confidence)
            };
          } else {
            const wordCoverage = score / Math.max(targetWords.length, 1);
            const confidence = Math.max(similarity, wordCoverage);
            if (!fallbackMatch || similarity > fallbackMatch.similarity) {
              fallbackMatch = {
                startSegmentIdx: windowStart,
                endSegmentIdx: i,
                similarity,
                confidence: Math.min(1, confidence)
              };
            }
          }
        }
      }
    }
  }
  
  if (fallbackMatch) {
    const endSegment = transcript[fallbackMatch.endSegmentIdx];
    return {
      found: true,
      startSegmentIdx: fallbackMatch.startSegmentIdx,
      endSegmentIdx: fallbackMatch.endSegmentIdx,
      startCharOffset: 0,
      endCharOffset: endSegment ? endSegment.text.length : 0,
      matchStrategy: 'fuzzy-ngram',
      similarity: fallbackMatch.similarity,
      confidence: fallbackMatch.confidence
    };
  }

  return null;
}

// Map a match position in the full text to segment boundaries
export function mapMatchToSegments(
  matchStart: number,
  matchLength: number,
  index: TranscriptIndex
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  const matchEnd = matchStart + matchLength;
  let startSegmentIdx = -1;
  let endSegmentIdx = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;
  
  for (const boundary of index.segmentBoundaries) {
    // Find start segment
    if (startSegmentIdx === -1 && matchStart >= boundary.startPos && matchStart < boundary.endPos) {
      startSegmentIdx = boundary.segmentIdx;
      startCharOffset = matchStart - boundary.startPos;
    }
    
    // Find end segment
    if (matchEnd > boundary.startPos && matchEnd <= boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = matchEnd - boundary.startPos;
      break;
    } else if (matchEnd > boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = boundary.text.length;
    }
  }
  
  if (startSegmentIdx !== -1 && endSegmentIdx !== -1) {
    return {
      found: true,
      startSegmentIdx,
      endSegmentIdx,
      startCharOffset,
      endCharOffset
    };
  }
  
  return null;
}

// Map normalized match back to original segments
export function mapNormalizedMatchToSegments(
  normalizedMatchIdx: number,
  normalizedTargetText: string,
  index: TranscriptIndex,
  _originalTargetText: string
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  const length = normalizedTargetText.length;
  if (length === 0) {
    return null;
  }

  const startEntry = index.normalizedIndexMap[normalizedMatchIdx];
  const endEntry = index.normalizedIndexMap[normalizedMatchIdx + length - 1];

  if (!startEntry || !endEntry) {
    return null;
  }

  let startSegmentIdx = startEntry.segmentIdx;
  let startCharOffset = startEntry.charOffset;
  if (startEntry.isBoundary && startEntry.nextSegmentIdx !== undefined) {
    startSegmentIdx = startEntry.nextSegmentIdx;
    startCharOffset = 0;
  } else {
    const startSegmentLength = index.segmentBoundaries[startSegmentIdx]?.text.length ?? 0;
    startCharOffset = Math.max(0, Math.min(startSegmentLength, startCharOffset));
  }

  let endSegmentIdx = endEntry.segmentIdx;
  let endCharOffset = endEntry.charOffset + 1;
  if (endEntry.isBoundary) {
    const segmentLength = index.segmentBoundaries[endSegmentIdx]?.text.length ?? 0;
    endCharOffset = segmentLength;
  } else {
    const segmentLength = index.segmentBoundaries[endSegmentIdx]?.text.length ?? 0;
    endCharOffset = Math.min(segmentLength, endCharOffset);
  }

  if (endSegmentIdx === startSegmentIdx) {
    endCharOffset = Math.max(startCharOffset + 1, endCharOffset);
  }

  return {
    found: true,
    startSegmentIdx,
    endSegmentIdx,
    startCharOffset,
    endCharOffset
  };
}
