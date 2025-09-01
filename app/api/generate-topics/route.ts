import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment } from '@/lib/types';

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
          
          const chunkText = chunkSegments.map(s => s.text).join(' ');
          const snippet = chunkText.substring(0, 200) + (chunkText.length > 200 ? '...' : '');
          
          topicsArray.push({
            title: `Part ${i + 1}`,
            description: `Section ${i + 1} of the video`,
            quotes: [{
              timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
              text: snippet
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

    // Return topics without segments - segments will be processed separately
    const topics = topicsArray.map((topic: ParsedTopic, index: number) => ({
      id: `topic-${index}`,
      title: topic.title,
      description: topic.description || '',
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