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

// Helper function to normalize text for matching
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

function findExactQuotes(
  transcript: TranscriptSegment[],
  quotes: Array<{ timestamp: string; text: string }>
): { 
  start: number; 
  end: number; 
  text: string; 
  startSegmentIdx?: number; 
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  hasCompleteSentences?: boolean;
}[] {
  const result: { 
    start: number; 
    end: number; 
    text: string; 
    startSegmentIdx?: number; 
    endSegmentIdx?: number;
    startCharOffset?: number;
    endCharOffset?: number;
    hasCompleteSentences?: boolean;
  }[] = [];
  
  for (const quote of quotes) {
    // Parse timestamp if provided
    const timestampMatch = quote.timestamp?.match(/\[?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]?/);
    if (!timestampMatch) continue;
    
    const [startMin, startSec] = timestampMatch[1].split(':').map(Number);
    const [endMin, endSec] = timestampMatch[2].split(':').map(Number);
    const timestampStart = startMin * 60 + startSec;
    const timestampEnd = endMin * 60 + endSec;
    
    // Use the exact text from the quote
    const quoteText = quote.text.trim();
    if (!quoteText) continue;
    
    // Normalize quote text for matching
    const normalizedQuote = normalizeText(quoteText);
    
    // Find all segments within the timestamp range
    const segmentsInRange: { idx: number; segment: TranscriptSegment }[] = [];
    for (let i = 0; i < transcript.length; i++) {
      const segment = transcript[i];
      const segmentEnd = segment.start + segment.duration;
      
      // Include segments that overlap with timestamp range
      if (segment.start <= timestampEnd && segmentEnd >= timestampStart) {
        segmentsInRange.push({ idx: i, segment });
      }
    }
    
    if (segmentsInRange.length === 0) continue;
    
    // Join all segments in range to create searchable text
    const joinedText = segmentsInRange.map(s => s.segment.text).join(' ');
    const normalizedJoined = normalizeText(joinedText);
    
    // Try to find the normalized quote within the normalized joined text
    const normalizedPos = normalizedJoined.indexOf(normalizedQuote);
    
    if (normalizedPos !== -1) {
      // Found a match! Now we need to map back to the original text positions
      // For simplicity, we'll highlight all segments in the timestamp range
      // This is more accurate than trying to map normalized positions back
      const firstSegment = segmentsInRange[0];
      const lastSegment = segmentsInRange[segmentsInRange.length - 1];
      
      result.push({
        start: firstSegment.segment.start,
        end: lastSegment.segment.start + lastSegment.segment.duration,
        text: quoteText,
        startSegmentIdx: firstSegment.idx,
        endSegmentIdx: lastSegment.idx,
        startCharOffset: 0,
        endCharOffset: lastSegment.segment.text.length,
        hasCompleteSentences: false
      });
    } else {
      // Fallback: If we can't find the text even with normalization,
      // highlight all segments within the timestamp range
      console.log(`Could not find normalized text match for quote: "${quoteText.substring(0, 50)}..."`);
      console.log(`Falling back to timestamp-based highlighting for range [${timestampMatch[1]}-${timestampMatch[2]}]`);
      
      const firstSegment = segmentsInRange[0];
      const lastSegment = segmentsInRange[segmentsInRange.length - 1];
      
      result.push({
        start: firstSegment.segment.start,
        end: lastSegment.segment.start + lastSegment.segment.duration,
        text: joinedText, // Use the actual joined text from segments
        startSegmentIdx: firstSegment.idx,
        endSegmentIdx: lastSegment.idx,
        startCharOffset: 0,
        endCharOffset: lastSegment.segment.text.length,
        hasCompleteSentences: false
      });
    }
  }
  
  return result;
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
      
      // Pass the quotes directly to findExactQuotes
      const quotesArray = topic.quotes && Array.isArray(topic.quotes) ? topic.quotes : [];
      
      console.log(`Found ${quotesArray.length} quotes with timestamps`);
      
      // Find the exact segments for these quotes
      const segments = findExactQuotes(transcript, quotesArray);
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