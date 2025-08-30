export interface SentenceBoundary {
  start: number;
  end: number;
  text: string;
}

const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Dr', 'Ms', 'Prof', 'Sr', 'Jr', 'Inc', 'Ltd', 'Corp', 
  'Co', 'vs', 'etc', 'i.e', 'e.g', 'Ph.D', 'M.D', 'B.A', 'M.A', 'B.S', 
  'M.S', 'U.S', 'U.K', 'E.U', 'N.Y', 'L.A', 'D.C', 'Jan', 'Feb', 'Mar',
  'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec'
];

/**
 * Split text into sentences with improved detection
 */
export function splitIntoSentences(text: string): string[] {
  let processedText = text;
  
  // Temporarily replace abbreviations to avoid false sentence breaks
  ABBREVIATIONS.forEach(abbr => {
    const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
    processedText = processedText.replace(regex, `${abbr}<!DOT!>`);
  });
  
  // Handle decimal numbers (e.g., "3.14")
  processedText = processedText.replace(/(\d)\.(\d)/g, '$1<!DOT!>$2');
  
  // Split on sentence boundaries
  // Match: period/exclamation/question followed by space and capital letter, or at the end
  // Also handle quotes after punctuation
  const sentences = processedText.split(/(?<=[.!?][\"\']?)\s+(?=[A-Z\"\'])|(?<=[.!?][\"\']?)$/);
  
  // Restore dots and filter empty sentences
  return sentences
    .map(s => s.replace(/<!DOT!>/g, '.'))
    .filter(s => s.trim().length > 0);
}

/**
 * Check if text ends with a complete sentence
 */
export function endsWithCompleteSentence(text: string): boolean {
  const trimmed = text.trim();
  // Check for sentence ending punctuation, accounting for quotes and parentheses
  return /[.!?][\"\'\)]?$/.test(trimmed);
}

/**
 * Check if text starts with a sentence beginning
 */
export function startsWithSentenceBeginning(text: string): boolean {
  const trimmed = text.trim();
  // Check if starts with capital letter, quote, or parenthesis followed by capital
  return /^[A-Z]|^[\"\'\(][A-Z]/.test(trimmed);
}

/**
 * Find sentence boundaries that overlap with a character range
 */
export function findSentenceBoundariesInRange(
  text: string, 
  startChar: number, 
  endChar: number
): SentenceBoundary[] {
  const sentences = splitIntoSentences(text);
  const boundaries: SentenceBoundary[] = [];
  let currentPos = 0;
  
  for (const sentence of sentences) {
    const sentenceStart = text.indexOf(sentence, currentPos);
    if (sentenceStart === -1) continue;
    
    const sentenceEnd = sentenceStart + sentence.length;
    
    // Check if this sentence overlaps with our range
    if (sentenceEnd >= startChar && sentenceStart <= endChar) {
      boundaries.push({
        start: sentenceStart,
        end: sentenceEnd,
        text: sentence
      });
    }
    
    currentPos = sentenceEnd;
  }
  
  return boundaries;
}

/**
 * Extend a character range to complete sentence boundaries
 */
export function extendToSentenceBoundaries(
  text: string,
  startChar: number,
  endChar: number,
  minLength: number = 50
): { start: number; end: number; text: string } {
  const sentences = splitIntoSentences(text);
  let currentPos = 0;
  let extendedStart = startChar;
  let extendedEnd = endChar;
  let foundStart = false;
  let foundEnd = false;
  
  // Find sentences that contain our range
  for (const sentence of sentences) {
    const sentenceStart = text.indexOf(sentence, currentPos);
    if (sentenceStart === -1) continue;
    
    const sentenceEnd = sentenceStart + sentence.length;
    
    // Find the sentence containing the start position
    if (!foundStart && sentenceEnd >= startChar) {
      extendedStart = sentenceStart;
      foundStart = true;
    }
    
    // Find the sentence containing the end position
    if (sentenceStart <= endChar) {
      extendedEnd = sentenceEnd;
      foundEnd = true;
    }
    
    currentPos = sentenceEnd;
  }
  
  // Ensure minimum length by extending if needed
  const currentLength = extendedEnd - extendedStart;
  if (currentLength < minLength) {
    // Try to extend forward first
    const remainingText = text.substring(extendedEnd);
    const nextSentences = splitIntoSentences(remainingText);
    if (nextSentences.length > 0) {
      const nextSentence = nextSentences[0];
      const nextPos = text.indexOf(nextSentence, extendedEnd);
      if (nextPos !== -1) {
        extendedEnd = nextPos + nextSentence.length;
      }
    }
    
    // If still too short, try extending backward
    if (extendedEnd - extendedStart < minLength && extendedStart > 0) {
      const precedingText = text.substring(0, extendedStart);
      const prevSentences = splitIntoSentences(precedingText);
      if (prevSentences.length > 0) {
        const prevSentence = prevSentences[prevSentences.length - 1];
        const prevPos = precedingText.lastIndexOf(prevSentence);
        if (prevPos !== -1) {
          extendedStart = prevPos;
        }
      }
    }
  }
  
  return {
    start: extendedStart,
    end: extendedEnd,
    text: text.substring(extendedStart, extendedEnd).trim()
  };
}

/**
 * Calculate character offsets for text within multiple segments
 */
export function calculateSegmentCharOffsets(
  segments: { text: string; start: number; duration: number }[]
): Map<number, { charStart: number; charEnd: number }> {
  const offsets = new Map<number, { charStart: number; charEnd: number }>();
  let totalChars = 0;
  
  segments.forEach((segment, index) => {
    const charStart = totalChars;
    const charEnd = totalChars + segment.text.length;
    offsets.set(index, { charStart, charEnd });
    totalChars = charEnd + 1; // +1 for space between segments
  });
  
  return offsets;
}

/**
 * Find which segments contain a character range
 */
export function findSegmentsForCharRange(
  segments: { text: string }[],
  startChar: number,
  endChar: number
): { startIdx: number; endIdx: number; startCharInSegment: number; endCharInSegment: number } | null {
  let totalChars = 0;
  let startIdx = -1;
  let endIdx = -1;
  let startCharInSegment = 0;
  let endCharInSegment = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentStart = totalChars;
    const segmentEnd = totalChars + segment.text.length;
    
    // Check if start falls in this segment
    if (startIdx === -1 && startChar >= segmentStart && startChar < segmentEnd) {
      startIdx = i;
      startCharInSegment = startChar - segmentStart;
    }
    
    // Check if end falls in this segment
    if (endChar >= segmentStart && endChar <= segmentEnd) {
      endIdx = i;
      endCharInSegment = endChar - segmentStart;
    }
    
    totalChars = segmentEnd + 1; // +1 for space between segments
  }
  
  if (startIdx === -1 || endIdx === -1) {
    return null;
  }
  
  return { startIdx, endIdx, startCharInSegment, endCharInSegment };
}