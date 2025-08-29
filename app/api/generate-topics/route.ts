import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

interface ParsedTopic {
  title: string;
  description: string;
  quotes?: Array<{
    timestamp: string;
    text: string;
  }>;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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

function findExactQuotes(
  transcript: TranscriptSegment[],
  timestampRanges: Array<{ start: string; end: string }>
): { start: number; end: number; text: string }[] {
  const quotes: { start: number; end: number; text: string }[] = [];
  
  // Helper function to split text into sentences with improved detection
  const splitIntoSentences = (text: string): string[] => {
    // Handle common abbreviations that shouldn't be treated as sentence ends
    const abbreviations = ['Mr', 'Mrs', 'Dr', 'Ms', 'Prof', 'Sr', 'Jr', 'Inc', 'Ltd', 'Corp', 'Co', 'vs', 'etc', 'i.e', 'e.g'];
    let processedText = text;
    
    // Temporarily replace abbreviations to avoid false sentence breaks
    abbreviations.forEach(abbr => {
      const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
      processedText = processedText.replace(regex, `${abbr}<!DOT!>`);
    });
    
    // Split on sentence boundaries (. ! ? followed by space and capital letter, or at the end)
    const sentences = processedText.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/);
    
    // Restore dots in abbreviations
    return sentences.map(s => s.replace(/<!DOT!>/g, '.')).filter(s => s.trim().length > 0);
  };
  
  // Helper function to check if text ends with a complete sentence
  const endsWithCompleteSentence = (text: string): boolean => {
    const trimmed = text.trim();
    // Check for sentence ending punctuation, accounting for quotes
    return /[.!?][\"\']?$/.test(trimmed);
  };
  
  // Helper function to check if text starts with a sentence beginning
  const startsWithSentenceBeginning = (text: string): boolean => {
    const trimmed = text.trim();
    // Check if starts with capital letter or quote followed by capital
    return /^[A-Z]|^[\"\'][A-Z]/.test(trimmed);
  };
  
  // Helper function to find segment index by time
  const findSegmentIndex = (time: number): number => {
    for (let i = 0; i < transcript.length; i++) {
      const segEnd = transcript[i].start + transcript[i].duration;
      if (transcript[i].start <= time && segEnd >= time) {
        return i;
      }
    }
    return -1;
  };
  
  // Helper function to find sentence boundaries within a range of segments
  const findSentenceBoundaries = (startIdx: number, endIdx: number): { startIdx: number; endIdx: number; text: string } => {
    // Expand the range to capture more context for finding sentence boundaries
    const contextStartIdx = Math.max(0, startIdx - 10);
    const contextEndIdx = Math.min(transcript.length - 1, endIdx + 10);
    
    // Combine all segments in the context range
    let fullContext = '';
    let segmentStartPositions: number[] = [];
    
    for (let i = contextStartIdx; i <= contextEndIdx; i++) {
      segmentStartPositions[i] = fullContext.length;
      fullContext += (i > contextStartIdx ? ' ' : '') + transcript[i].text;
    }
    
    // Find the position of the target content within the full context
    const targetStartPos = segmentStartPositions[startIdx];
    const targetEndPos = segmentStartPositions[endIdx] + transcript[endIdx].text.length;
    
    // Split the full context into sentences
    const sentences = splitIntoSentences(fullContext);
    let currentPos = 0;
    let selectedSentences: string[] = [];
    let foundStart = false;
    let newStartIdx = startIdx;
    let newEndIdx = endIdx;
    
    // Find sentences that overlap with our target range
    for (const sentence of sentences) {
      const sentenceEnd = currentPos + sentence.length;
      
      // Check if this sentence overlaps with our target range
      if (sentenceEnd >= targetStartPos && currentPos <= targetEndPos) {
        selectedSentences.push(sentence);
        
        // Track the actual segment indices for the first and last sentences
        if (!foundStart) {
          // Find which segment this sentence starts in
          for (let i = contextStartIdx; i <= contextEndIdx; i++) {
            if (segmentStartPositions[i] <= currentPos && 
                (i === contextEndIdx || segmentStartPositions[i + 1] > currentPos)) {
              newStartIdx = i;
              foundStart = true;
              break;
            }
          }
        }
        
        // Update end index for each included sentence
        for (let i = contextStartIdx; i <= contextEndIdx; i++) {
          if (segmentStartPositions[i] <= sentenceEnd && 
              (i === contextEndIdx || segmentStartPositions[i + 1] > sentenceEnd)) {
            newEndIdx = i;
            break;
          }
        }
      }
      
      currentPos = sentenceEnd + 1; // +1 for the space between sentences
    }
    
    // If we found complete sentences, use them
    if (selectedSentences.length > 0) {
      const completeText = selectedSentences.join(' ').trim();
      
      // Ensure we have substantial content
      if (completeText.length > 50) {
        return {
          startIdx: newStartIdx,
          endIdx: newEndIdx,
          text: completeText
        };
      }
    }
    
    // Fallback: use original range but try to complete sentences
    let fallbackText = '';
    let fallbackStartIdx = startIdx;
    let fallbackEndIdx = endIdx;
    
    // Extend backward to find sentence beginning
    for (let i = startIdx; i >= Math.max(0, startIdx - 5); i--) {
      const testText = transcript.slice(i, endIdx + 1).map(s => s.text).join(' ');
      if (i === 0 || endsWithCompleteSentence(transcript[i - 1].text) || startsWithSentenceBeginning(transcript[i].text)) {
        fallbackStartIdx = i;
        fallbackText = testText;
        break;
      }
    }
    
    // Extend forward to find sentence ending
    for (let i = endIdx; i <= Math.min(transcript.length - 1, endIdx + 5); i++) {
      if (endsWithCompleteSentence(transcript[i].text)) {
        fallbackEndIdx = i;
        break;
      }
    }
    
    // Build the final text
    const segments: string[] = [];
    for (let i = fallbackStartIdx; i <= fallbackEndIdx; i++) {
      segments.push(transcript[i].text);
    }
    
    return {
      startIdx: fallbackStartIdx,
      endIdx: fallbackEndIdx,
      text: segments.join(' ').trim()
    };
  };
  
  for (const range of timestampRanges) {
    // Parse timestamp strings (format: "MM:SS")
    const [startMin, startSec] = range.start.split(':').map(Number);
    const [endMin, endSec] = range.end.split(':').map(Number);
    const startTime = startMin * 60 + startSec;
    const endTime = endMin * 60 + endSec;
    
    // Find the segment indices for start and end times
    let startIdx = findSegmentIndex(startTime);
    let endIdx = findSegmentIndex(endTime);
    
    if (startIdx === -1 || endIdx === -1) {
      // If we can't find exact segments, find the nearest ones
      startIdx = transcript.findIndex(seg => seg.start >= startTime);
      endIdx = transcript.findIndex(seg => seg.start + seg.duration >= endTime);
      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = transcript.length - 1;
    }
    
    // Find proper sentence boundaries for this range
    const { startIdx: boundedStartIdx, endIdx: boundedEndIdx, text: boundedText } = findSentenceBoundaries(startIdx, endIdx);
    
    // Calculate actual timestamps
    const actualStart = transcript[boundedStartIdx].start;
    const actualEnd = transcript[boundedEndIdx].start + transcript[boundedEndIdx].duration;
    
    // Only add if we have substantial content (at least 50 characters)
    if (boundedText.length > 50) {
      quotes.push({
        start: actualStart,
        end: actualEnd,
        text: boundedText
      });
    }
  }
  
  // Merge nearby quotes (within 5 seconds) to avoid fragmentation
  const mergedQuotes: { start: number; end: number; text: string }[] = [];
  let currentQuote: { start: number; end: number; text: string } | null = null;
  
  for (const quote of quotes) {
    if (!currentQuote) {
      currentQuote = { ...quote };
    } else if (quote.start - currentQuote.end <= 5) {
      // Merge quotes but ensure we maintain sentence boundaries
      const combinedText = currentQuote.text + ' ' + quote.text;
      const sentences = splitIntoSentences(combinedText);
      currentQuote.end = quote.end;
      currentQuote.text = sentences.join(' ').trim();
    } else {
      // Save current and start new
      mergedQuotes.push(currentQuote);
      currentQuote = { ...quote };
    }
  }
  
  if (currentQuote) {
    mergedQuotes.push(currentQuote);
  }
  
  return mergedQuotes;
}

export async function POST(request: Request) {
  try {
    const { transcript, model = 'gemini-2.5-flash' } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }
    
    // Validate model
    const validModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    if (!validModels.includes(model)) {
      return NextResponse.json(
        { error: 'Invalid model specified' },
        { status: 400 }
      );
    }

    const fullText = combineTranscript(transcript);
    
    // Log a sample of the transcript to help with debugging
    console.log('Analyzing transcript sample (first 200 chars):', fullText.substring(0, 200) + '...');
    console.log('Total transcript length:', fullText.length, 'characters');
    
    const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);

    const prompt = `## Role and Goal
You are an expert content strategist. Your goal is to analyze the provided video transcript and description to create 5 distinct "highlight reels." Each reel will focus on a single, powerful theme, supported by direct quotes from the speaker. The final output should allow a busy, intelligent viewer to absorb the video's most valuable insights in minutes.

## Target Audience
Your audience is forward-thinking and curious. They have a short attention span and are looking for contrarian insights, actionable mental models, and bold predictions, not generic advice.

## Your Task

### Step 1: Identify 5 Core Themes
Analyze the entire transcript to identify 5 key themes that are most valuable and thought-provoking.

**Theme/Title Criteria:**
- **Insightful:** It must challenge a common assumption or reframe a known concept.
- **Specific:** Avoid vague titles.
- **Format:** Must be a complete sentence or a question.
- **Concise:** Maximum of 10 words.
- **Synthesized:** The theme should connect ideas from different parts of the talk, not just one section.

### Step 2: Select Supporting Passages
For each theme, select 1 to 5 direct passages from the transcript that powerfully illustrate the core idea.

**CRITICAL Passage Selection Criteria:**
- **Direct Quotes Only:** Use complete, unedited sentences from the transcript. Do NOT summarize, paraphrase, or use ellipses.
- **LENGTH REQUIREMENT:** Each passage MUST be substantial enough to convey a complete thought or idea. Minimum 15-30 seconds of content. Short fragments are unacceptable.
- **Complete Thoughts:** ALWAYS extend the timestamp range to capture the FULL idea being expressed. Include the entire explanation, example, or argument - not just a fragment.
- **Self-Contained:** Each passage must be fully understandable on its own. If the speaker references something earlier, extend the passage backward to include that context.
- **Natural Boundaries:** Extend timestamps to natural speech breaks - complete sentences, paragraph ends, or topic transitions. NEVER cut off mid-sentence or mid-thought.
- **High-Signal:** Choose passages that contain memorable stories, bold predictions, data points, specific examples, or contrarian thinking. Avoid generic statements.
- **No Fluff:** While passages should be complete, avoid including unrelated tangents or off-topic rambling.
- **Avoid Redundancy:** Within a single reel, ensure each selected passage offers a unique angle on the theme.
- **Chronological:** Within each reel, list the passages in the order they appear in the video.

**Examples of Good vs Bad Passages:**
❌ BAD: [02:15-02:25] "The problem with traditional education is that it doesn't..."
✅ GOOD: [02:15-03:10] "The problem with traditional education is that it doesn't prepare you for the real world. When I graduated from Stanford, I realized I had memorized hundreds of formulas but couldn't negotiate a salary, manage my finances, or build meaningful relationships. The system optimizes for test scores, not life skills. We spend 16 years in school learning calculus we'll never use, but zero hours learning how to handle failure, manage emotions, or think critically about the media we consume."

## Quality Control
- **Distinct Themes:** Each highlight reel's title must represent a clearly distinct theme. While themes can be related, their core ideas should be unique.
- **Value Over Quantity:** If you can only identify 3-4 high-quality, distinct themes, deliver that number. Do not force generic themes to meet the count of 5.
- **Passage Completeness Check:** Before finalizing, verify each passage contains a COMPLETE thought that can stand alone. If it references something not included, extend the timestamp range.

## Output Format
You must return a JSON array with this EXACT structure:
[
  {
    "title": "Complete sentence or question",
    "quotes": [
      {
        "timestamp": "[MM:SS-MM:SS]",
        "text": "Exact transcript of passage as it appears"
      }
    ]
  }
]

## Video Transcript (with timestamps)
${transcriptWithTimestamps}

`;
    
    

    console.log(`Using model: ${model}`);
    
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();
    
    if (!response) {
      throw new Error('No response from Gemini');
    }

    console.log('Raw Gemini response:', response);
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      console.log('Attempting to extract JSON from response...');
      
      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('Failed to extract JSON:', e);
          // Create a fallback response
          parsedResponse = [{
            title: "Full Video",
            description: "Complete video content",
            quotes: [{
              timestamp: "[00:00-00:30]",
              text: fullText.substring(0, 200)
            }]
          }];
        }
      } else {
        // Create a fallback response
        parsedResponse = [{
          title: "Full Video",
          description: "Complete video content",
          quotes: [{
            timestamp: "[00:00-00:30]",
            text: fullText.substring(0, 200)
          }]
        }];
      }
    }
    
    console.log('Parsed Gemini response:', JSON.stringify(parsedResponse, null, 2));
    
    // Handle different possible response structures
    let topicsArray = parsedResponse;
    if (parsedResponse.topics && Array.isArray(parsedResponse.topics)) {
      topicsArray = parsedResponse.topics;
    } else if (parsedResponse.themes && Array.isArray(parsedResponse.themes)) {
      topicsArray = parsedResponse.themes;
    } else if (!Array.isArray(parsedResponse)) {
      console.error('Unexpected response structure:', parsedResponse);
      throw new Error('Invalid response format from Gemini - not an array');
    }
    
    // If we got an empty array, create a basic structure
    if (topicsArray.length === 0) {
      console.log('Gemini returned empty array, creating fallback topics');
      
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
            description: `Section ${i + 1} of the video`,
            quotes: [{
              timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
              text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
            }]
          });
        }
      }
    }
    
    console.log(`Found ${topicsArray.length} highlight reels from Gemini`);
    
    // Validate that topics have required fields
    topicsArray.forEach((topic: ParsedTopic, index: number) => {
      console.log(`Highlight Reel ${index + 1}:`, {
        title: topic.title,
        hasQuotes: !!topic.quotes,
        quoteCount: topic.quotes ? topic.quotes.length : 0
      });
    });

    // Generate topics with segments from quotes
    const topicsWithSegments = topicsArray.map((topic: ParsedTopic, index: number) => {
      console.log(`\nProcessing Highlight Reel ${index + 1}: "${topic.title}"`);
      
      // Extract timestamp ranges from quotes
      const timestampRanges: Array<{ start: string; end: string }> = [];
      
      if (topic.quotes && Array.isArray(topic.quotes)) {
        topic.quotes.forEach((quote: any) => {
          // Parse timestamp format "[MM:SS-MM:SS]" or "MM:SS-MM:SS"
          const timestampMatch = quote.timestamp?.match(/\[?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]?/);
          if (timestampMatch) {
            timestampRanges.push({
              start: timestampMatch[1],
              end: timestampMatch[2]
            });
          }
        });
      }
      
      console.log(`Found ${timestampRanges.length} quotes with timestamps`);
      
      // Find the exact segments for these timestamps
      const segments = findExactQuotes(transcript, timestampRanges);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      console.log(`Result: Found ${segments.length} quote segments covering ${Math.round(totalDuration)} seconds`);
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: Math.round(totalDuration),
        segments: segments,
        quotes: topic.quotes // Store original quotes for display
      };
    });
    
    // Keep all topics, even those without segments (they can still be displayed)
    const topics = topicsWithSegments.length > 0 ? topicsWithSegments : 
      topicsArray.map((topic: ParsedTopic, index: number) => ({
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: 0,
        segments: [],
        quotes: topic.quotes || []
      }));
    
    console.log(`Total highlight reels: ${topics.length} (${topicsWithSegments.filter((t: Topic) => t.segments.length > 0).length} with segments)`)

    return NextResponse.json({ topics });
  } catch (error) {
    console.error('Error generating topics:', error);
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}