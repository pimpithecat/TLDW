import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';
import { 
  normalizeWhitespace,
  normalizeForMatching,
  calculateNgramSimilarity,
  buildTranscriptIndex,
  findTextInTranscript,
  TranscriptIndex
} from '@/lib/quote-matcher';

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
    
    
    // Show first and last parts for debugging
    if (quoteText.length > 100) {
    }
    
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
      
      // DEBUG: Verify the segment content
      if (match.startSegmentIdx > 0) {
      }
      
      // Check if the quote actually matches what we found
      const extractedText = startSegment.text.substring(match.startCharOffset);
      const quotePortion = quoteText.substring(0, Math.min(50, extractedText.length));
      if (!extractedText.startsWith(quotePortion.substring(0, 20))) {
      }
      
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
      
      // Use pre-built index for debugging
      const quoteNormalized = normalizeWhitespace(quoteText);
      const transcriptNormalized = index.normalizedText;
      
      // Check if normalized version exists
      if (transcriptNormalized.includes(quoteNormalized)) {
      } else {
        // Check for partial matches
        const quoteWords = quoteNormalized.split(' ').filter(w => w.length > 3);
        const firstWords = quoteWords.slice(0, 5).join(' ');
        const lastWords = quoteWords.slice(-5).join(' ');
        
        if (transcriptNormalized.includes(firstWords)) {
        }
        if (transcriptNormalized.includes(lastWords)) {
        }
      }
      
      
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
      let foundInRange = false;
      const rangeMatch = findTextInTranscript(transcript, quoteText, index, {
        startIdx: Math.max(0, startSearchIdx - 2),
        strategy: 'all',
        minSimilarity: 0.75, // More lenient for timestamp range
        maxSegmentWindow: Math.min(20, endSearchIdx - startSearchIdx + 5)
      });
      
      if (rangeMatch && rangeMatch.startSegmentIdx <= endSearchIdx + 2) {
        
        const startSegment = transcript[rangeMatch.startSegmentIdx];
        const endSegment = transcript[rangeMatch.endSegmentIdx];
        
        foundInRange = true;
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
      
      if (!foundInRange) {
        // Final fallback: Use timestamp range
        
        const firstSegment = segmentsInRange[0];
        const lastSegment = segmentsInRange[segmentsInRange.length - 1];
        const joinedText = segmentsInRange.map(s => s.segment.text).join(' ');
        
        // Show why matching failed for debugging
        if (quoteText.length > 100 && joinedText.length > 100) {
        }
        
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
    }
    
    return null; // Quote not found
  });
  
  const results = await Promise.all(quotePromises);
  return results.filter(r => r !== null) as any[];
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
    
    // Debug segments around index 40-46
    for (let i = 40; i <= 46 && i < transcript.length; i++) {
    }
    
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
    
    **Passage Selection Criteria:**
    - **Direct Quotes Only:** Use complete, unedited sentences from the transcript. Do **not** summarize, paraphrase, or use ellipses (...).
    - **Self-Contained:** Each passage must be fully understandable on its own. If the speaker references something earlier, extend the passage backward to include that context.
    - **High-Signal:** Choose passages that contain memorable stories, bold predictions, data points, specific examples, or contrarian thinking. Avoid generic statements.
    - **No Fluff:** While passages should be complete, avoid including unrelated tangents or off-topic rambling.
    - **Avoid Redundancy:** Within a single reel, ensure each selected passage offers a unique angle on the theme.
    - **Chronological:** Within each reel, list the passages in the order they appear in the video.
    
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
           "text": "EXACT verbatim text from transcript - must be a perfect character-by-character match"
         }
       ]
     }
    ]
    
    IMPORTANT: The "text" field MUST contain the exact text as it appears in the transcript. Do not clean up, correct, or modify the text in any way.
    
    ## Video Transcript (with timestamps)
    ${transcriptWithTimestamps}
    `;
    
    
    

    
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();
    
    // DEBUG: Print the raw response from Gemini
    console.log('=== RAW GEMINI RESPONSE ===');
    console.log('Response length:', response?.length || 0);
    console.log('Response content:');
    console.log(response);
    console.log('=== END RAW RESPONSE ===');
    
    if (!response) {
      throw new Error('No response from Gemini');
    }

    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response);
      console.log('=== PARSED RESPONSE ===');
      console.log('Parsed successfully. Type:', typeof parsedResponse);
      console.log('Is Array:', Array.isArray(parsedResponse));
      console.log('Keys:', Object.keys(parsedResponse));
      console.log('Content:', JSON.stringify(parsedResponse, null, 2));
      console.log('=== END PARSED RESPONSE ===');
    } catch (parseError) {
      console.log('=== JSON PARSE ERROR ===');
      console.log('Parse error:', parseError);
      console.log('Attempting to extract JSON array from response...');
      
      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        console.log('Found JSON array match:', jsonMatch[0].substring(0, 200) + '...');
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
          console.log('Successfully parsed extracted JSON array');
        } catch (e) {
          console.log('Failed to parse extracted JSON:', e);
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
        console.log('No JSON array found in response, using fallback');
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
    
    
    // Handle different possible response structures
    let topicsArray = parsedResponse;
    if (parsedResponse.topics && Array.isArray(parsedResponse.topics)) {
      topicsArray = parsedResponse.topics;
    } else if (parsedResponse.themes && Array.isArray(parsedResponse.themes)) {
      topicsArray = parsedResponse.themes;
    } else if (!Array.isArray(parsedResponse)) {
      throw new Error('Invalid response format from Gemini - not an array');
    }
    
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
            description: `Section ${i + 1} of the video`,
            quotes: [{
              timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
              text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
            }]
          });
        }
      }
    }
    
    
    // Validate that topics have required fields
    topicsArray.forEach((topic: ParsedTopic, index: number) => {
      console.log({
        title: topic.title,
        hasQuotes: !!topic.quotes,
        quoteCount: topic.quotes ? topic.quotes.length : 0
      });
    });

    // Pre-build transcript index once for all quotes
    const transcriptIndex = buildTranscriptIndex(transcript);
    
    // Generate topics with segments from quotes (parallel processing)
    const topicsWithSegments = await Promise.all(
      topicsArray.map(async (topic: ParsedTopic, index: number) => {
        
        // Pass the quotes directly to findExactQuotes
        const quotesArray = topic.quotes && Array.isArray(topic.quotes) ? topic.quotes : [];
        
        
        // Find the exact segments for these quotes (now async with parallel processing)
        const segments = await findExactQuotes(transcript, quotesArray, transcriptIndex);
        const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
        
        
        return {
          id: `topic-${index}`,
          title: topic.title,
          description: topic.description || '',
          duration: Math.round(totalDuration),
          segments: segments,
          quotes: topic.quotes // Store original quotes for display
        };
      })
    );
    
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
    

    return NextResponse.json({ topics });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}