import { NextResponse } from 'next/server';
import { TranscriptSegment } from '@/lib/types';

interface ParsedTopic {
  title: string;
  description: string;
  quotes?: Array<{
    timestamp: string;
    text: string;
  }>;
}

// Text normalization utilities
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")     // Normalize quotes
    .replace(/[""]/g, '"')     // Normalize double quotes
    .replace(/…/g, '...')      // Normalize ellipsis
    .replace(/—/g, '-')        // Normalize dashes
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

// Calculate similarity between two strings (0-1)
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Build a comprehensive index of the transcript
interface TranscriptIndex {
  fullTextSpace: string;
  fullTextNewline: string;
  segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
  }>;
  normalizedSegments: string[];
}

function buildTranscriptIndex(segments: TranscriptSegment[]): TranscriptIndex {
  const normalizedSegments = segments.map(s => normalizeForMatching(s.text));
  
  // Build full text with different separators
  const fullTextSpace = segments.map(s => s.text).join(' ');
  const fullTextNewline = segments.map(s => s.text).join('\n');
  
  // Track segment boundaries in the full text
  const segmentBoundaries: Array<{segmentIdx: number; startPos: number; endPos: number}> = [];
  let currentPos = 0;
  
  segments.forEach((segment, idx) => {
    segmentBoundaries.push({
      segmentIdx: idx,
      startPos: currentPos,
      endPos: currentPos + segment.text.length
    });
    currentPos += segment.text.length + 1; // +1 for separator
  });
  
  return {
    fullTextSpace,
    fullTextNewline,
    segmentBoundaries,
    normalizedSegments
  };
}

// Parse timestamp string (e.g., "03:45" or "3:45:30") to seconds
function parseTimestamp(timestamp: string): number | null {
  if (!timestamp) return null;
  
  const parts = timestamp.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  
  return null;
}

function findExactQuotes(
  transcript: TranscriptSegment[],
  quotes: Array<{ timestamp: string; text: string }>
): { 
  start: number; 
  end: number; 
  text: string; 
  matchedQuote: string 
}[] {
  if (!quotes || quotes.length === 0) return [];
  
  const index = buildTranscriptIndex(transcript);
  const segments: { start: number; end: number; text: string; matchedQuote: string }[] = [];
  const mergedSegments = new Set<string>();
  
  for (const quote of quotes) {
    if (!quote.text) continue;
    
    const targetTime = parseTimestamp(quote.timestamp);
    const normalizedQuote = normalizeForMatching(quote.text);
    const quoteWords = normalizedQuote.split(/\s+/).filter(w => w.length > 0);
    
    if (quoteWords.length < 3) continue;
    
    // Multi-strategy matching
    let bestMatch: {
      startIdx: number;
      endIdx: number;
      confidence: number;
      method: string;
    } | null = null;
    
    // Strategy 1: Exact substring match (highest confidence)
    for (let i = 0; i < index.normalizedSegments.length; i++) {
      if (index.normalizedSegments[i].includes(normalizedQuote)) {
        bestMatch = {
          startIdx: i,
          endIdx: i,
          confidence: 1.0,
          method: 'exact'
        };
        break;
      }
    }
    
    // Strategy 2: Multi-segment exact match
    if (!bestMatch) {
      for (let startIdx = 0; startIdx < transcript.length - 1; startIdx++) {
        for (let span = 2; span <= Math.min(5, transcript.length - startIdx); span++) {
          const combined = transcript
            .slice(startIdx, startIdx + span)
            .map(s => s.text)
            .join(' ');
          const normalizedCombined = normalizeForMatching(combined);
          
          if (normalizedCombined.includes(normalizedQuote)) {
            bestMatch = {
              startIdx,
              endIdx: startIdx + span - 1,
              confidence: 0.95,
              method: 'multi-exact'
            };
            break;
          }
        }
        if (bestMatch) break;
      }
    }
    
    // Strategy 3: Sliding window with fuzzy matching
    if (!bestMatch) {
      const windowSizes = [1, 2, 3, 4, 5];
      let bestSimilarity = 0;
      
      for (const windowSize of windowSizes) {
        for (let i = 0; i <= transcript.length - windowSize; i++) {
          const windowText = transcript
            .slice(i, i + windowSize)
            .map(s => s.text)
            .join(' ');
          const normalizedWindow = normalizeForMatching(windowText);
          
          // Try different alignments within the window
          const words = normalizedWindow.split(/\s+/);
          for (let j = 0; j <= words.length - quoteWords.length; j++) {
            const subset = words.slice(j, j + quoteWords.length).join(' ');
            const similarity = calculateSimilarity(normalizedQuote, subset);
            
            if (similarity > bestSimilarity && similarity > 0.8) {
              bestSimilarity = similarity;
              bestMatch = {
                startIdx: i,
                endIdx: i + windowSize - 1,
                confidence: similarity,
                method: 'fuzzy'
              };
            }
          }
        }
      }
    }
    
    // Strategy 4: Time-guided search with relaxed matching
    if (!bestMatch && targetTime !== null) {
      const timeWindow = 30; // Look within 30 seconds
      const candidateIndices = transcript
        .map((s, idx) => ({ idx, time: s.start }))
        .filter(({ time }) => Math.abs(time - targetTime) <= timeWindow)
        .map(({ idx }) => idx);
      
      let bestTimeSimilarity = 0;
      for (const idx of candidateIndices) {
        for (let span = 1; span <= 3; span++) {
          if (idx + span > transcript.length) break;
          
          const combined = transcript
            .slice(idx, idx + span)
            .map(s => s.text)
            .join(' ');
          const normalizedCombined = normalizeForMatching(combined);
          
          // Check for key phrases (first and last few words)
          const firstThreeWords = quoteWords.slice(0, 3).join(' ');
          const lastThreeWords = quoteWords.slice(-3).join(' ');
          
          if (normalizedCombined.includes(firstThreeWords) || 
              normalizedCombined.includes(lastThreeWords)) {
            bestMatch = {
              startIdx: idx,
              endIdx: idx + span - 1,
              confidence: 0.7,
              method: 'time-guided'
            };
            break;
          }
          
          // Fuzzy match
          const similarity = calculateSimilarity(normalizedQuote, normalizedCombined);
          if (similarity > bestTimeSimilarity && similarity > 0.6) {
            bestTimeSimilarity = similarity;
            bestMatch = {
              startIdx: idx,
              endIdx: idx + span - 1,
              confidence: similarity,
              method: 'time-fuzzy'
            };
          }
        }
      }
    }
    
    // Apply the best match found
    if (bestMatch && bestMatch.confidence > 0.6) {
      // Extend context for better viewing experience
      const contextBefore = 2;
      const contextAfter = 2;
      const extendedStart = Math.max(0, bestMatch.startIdx - contextBefore);
      const extendedEnd = Math.min(transcript.length - 1, bestMatch.endIdx + contextAfter);
      
      const segmentKey = `${extendedStart}-${extendedEnd}`;
      if (!mergedSegments.has(segmentKey)) {
        mergedSegments.add(segmentKey);
        
        const segmentText = transcript
          .slice(extendedStart, extendedEnd + 1)
          .map(s => s.text)
          .join(' ');
        
        segments.push({
          start: transcript[extendedStart].start,
          end: transcript[extendedEnd].start + transcript[extendedEnd].duration,
          text: segmentText,
          matchedQuote: quote.text
        });
      }
    }
  }
  
  // Merge overlapping segments
  segments.sort((a, b) => a.start - b.start);
  const merged: typeof segments = [];
  
  for (const segment of segments) {
    if (merged.length === 0) {
      merged.push(segment);
    } else {
      const last = merged[merged.length - 1];
      if (segment.start <= last.end + 5) {
        // Merge segments that are within 5 seconds
        last.end = Math.max(last.end, segment.end);
        last.text = last.text + ' ... ' + segment.text;
        last.matchedQuote = last.matchedQuote + ' | ' + segment.matchedQuote;
      } else {
        merged.push(segment);
      }
    }
  }
  
  // Ensure minimum duration for each segment
  return merged.map(segment => ({
    ...segment,
    end: Math.max(segment.end, segment.start + 15) // Minimum 15 seconds
  }));
}

export async function POST(req: Request) {
  try {
    const { transcript, topics } = await req.json();
    
    if (!transcript || !topics) {
      return NextResponse.json(
        { error: 'Missing required data' },
        { status: 400 }
      );
    }
    
    // Process each topic to find exact quotes
    const processedTopics = topics.map((topic: ParsedTopic, index: number) => {
      const quotesArray = topic.quotes && Array.isArray(topic.quotes) ? topic.quotes : [];
      
      // Find the exact segments for these quotes
      const segments = findExactQuotes(transcript, quotesArray);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: Math.round(totalDuration),
        segments: segments,
        quotes: topic.quotes // Store original quotes for display
      };
    });
    
    return NextResponse.json({ topics: processedTopics });
  } catch (error) {
    console.error('Error processing quotes:', error);
    return NextResponse.json(
      { error: 'Failed to process quotes' },
      { status: 500 }
    );
  }
}