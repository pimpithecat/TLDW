import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic, ChatMessage, Citation } from '@/lib/types';
import { buildTranscriptIndex, findTextInTranscript } from '@/lib/quote-matcher';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function formatTranscriptForContext(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `[${timestamp}] ${s.text}`;
  }).join('\n');
}

export async function POST(request: Request) {
  try {
    const { message, transcript, topics, chatHistory, model } = await request.json();

    if (!message || !transcript) {
      return NextResponse.json(
        { error: 'Message and transcript are required' },
        { status: 400 }
      );
    }

    const transcriptContext = formatTranscriptForContext(transcript);
    const topicsContext = topics.map((t: Topic) => 
      `- ${t.title}: ${t.description}`
    ).join('\n');

    const chatHistoryContext = chatHistory?.map((msg: ChatMessage) => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n\n') || '';

    const prompt = `You are a concise AI assistant helping users understand a video transcript. Your task is to answer the user's question based ONLY on the provided transcript and supporting materials.

## Core Task
1. **Answer the Question**: Formulate a direct, concise answer to the user's question in Markdown.
2. **Cite Sources**: Back up your answer with exact quotes from the transcript.
3. **Provide JSON**: Return a single JSON object containing your answer and the quotes.

## Detailed Instructions

### 1. Answer Formatting
- Your final \`answer\` text MUST include citation placeholders numbered starting from [1] (e.g. \`[1]\`, \`[2]\`, etc.), corresponding to the quotes you select.

### 2. Quote Selection Criteria
- **Verbatim Quotes Only**: The \`text\` for each quote MUST be an EXACT, character-for-character copy of a passage from the transcript.
- **Complete Sentences**: Each quote MUST be a complete sentence or a series of complete sentences. **Do NOT return partial or truncated sentences.** For example, do not end a quote with "...how to integ". It must be the full sentence.
- **Self-Contained**: Each quote must be fully understandable on its own.
- **No Summarizing**: Do NOT summarize or paraphrase the transcript in the \`quotes\` array.

### 3. JSON Output Structure
- You MUST return a single JSON object. Do not include any other text or formatting outside of this JSON object.

## Example of the Required JSON Output
\`\`\`json
{
  "answer": "AI Fund focuses on concrete ideas because they can be quickly validated or falsified [1]. This is paired with rapid engineering, which utilizes AI coding assistants to increase speed and reduce costs [2].",
  "quotes": [
    { "text": "We focus on concrete ideas, things that can be built quickly so that we can quickly validate or falsify them." },
    { "text": "We use a lot of AI coding assistants to really dramatically increase the speed of engineering and reduce the cost." }
  ]
}
\`\`\`

## IMPORTANT CHECKS
- Before generating the response, double-check that your \`answer\` text contains the citation placeholders (e.g., \`[1]\`, \`[2]\`, etc.).
- The \`text\` field MUST contain the exact text as it appears in the transcript. Do not clean up, correct, or modify the text in any way.
- The first citation placeholder should corresponding to the first quote in the \`quotes\` array. The second citation placeholder should correspond to the second quote in the \`quotes\` array, and so on.
- The total number of citation placeholders should correspond to the total number of quotes in the \`quotes\` array.

## Context
Video Topics:
${topicsContext}

Previous Conversation:
${chatHistoryContext}

## Full Video Transcript
${transcriptContext}

## User Question
${message}`;

    const selectedModel = model && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(model) 
      ? model 
      : 'gemini-2.5-flash';

    const maxOutputTokens = selectedModel === 'gemini-2.0-flash' ? 8192 : 65536;

    const aiModel = genAI.getGenerativeModel({ 
      model: selectedModel,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.6,
        maxOutputTokens: Math.min(1024, maxOutputTokens),
      }
    });

    let response = '';
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        const result = await aiModel.generateContent(prompt);
        response = result.response?.text() || '';
        
        // Debug: Log the raw response from Gemini
        console.log('=== GEMINI RAW RESPONSE ===');
        console.log('Response length:', response.length);
        console.log('Raw response:', response);
        console.log('=== END RAW RESPONSE ===');
        
        if (response) {
          break; // Success, exit retry loop
        }
      } catch (error: any) {
        
        if (retryCount === maxRetries) {
          // Final attempt failed
          const errorMessage = error?.message || 'Unknown error';
          if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            return NextResponse.json({ 
              content: "The AI service is currently at capacity. Please wait a moment and try again.",
              citations: [],
            });
          }
          return NextResponse.json({ 
            content: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
            citations: [],
          });
        }
        
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
        retryCount++;
      }
    }
    
    if (!response) {
      return NextResponse.json({ 
        content: "I couldn't generate a response. Please try rephrasing your question.",
        citations: [],
      });
    }

    // Parse the JSON response
    let parsedResponse;
    try {
      console.log('=== PARSING JSON RESPONSE ===');
      console.log('Response to parse:', response);
      parsedResponse = JSON.parse(response);
      console.log('Parsed response:', JSON.stringify(parsedResponse, null, 2));
      console.log('=== END PARSING ===');
    } catch (e) {
      console.log('=== JSON PARSING ERROR ===');
      console.log('Error:', e);
      console.log('Response that failed to parse:', response);
      console.log('=== END PARSING ERROR ===');
      return NextResponse.json({ 
        content: "I couldn't generate a valid response. Please try again.",
        citations: [],
      });
    }

    const { answer, quotes } = parsedResponse;

    console.log('=== EXTRACTED DATA ===');
    console.log('Answer:', answer);
    console.log('Quotes:', quotes);
    console.log('Quotes is array:', Array.isArray(quotes));
    console.log('=== END EXTRACTED DATA ===');

    if (!answer || !quotes || !Array.isArray(quotes)) {
      console.log('=== VALIDATION FAILED ===');
      console.log('Answer exists:', !!answer);
      console.log('Quotes exists:', !!quotes);
      console.log('Quotes is array:', Array.isArray(quotes));
      console.log('=== END VALIDATION FAILED ===');
      return NextResponse.json({
        content: answer || "I found some information, but couldn't format it correctly.",
        citations: [],
      });
    }

    // Build transcript index for efficient quote matching
    const transcriptIndex = buildTranscriptIndex(transcript);
    const citations: Omit<Citation, 'context'>[] = [];

    // Process each quote to find its location in the transcript
    await Promise.all(quotes.map(async (quote: { text: string }, index: number) => {
      if (typeof quote.text !== 'string' || !quote.text.trim()) return;

      // First attempt with a stricter similarity threshold
      let match = findTextInTranscript(transcript, quote.text, transcriptIndex, {
        strategy: 'all',
        minSimilarity: 0.75,
      });

      // Fallback with more lenient settings if the first attempt fails
      if (!match) {
        match = findTextInTranscript(transcript, quote.text, transcriptIndex, {
          strategy: 'all',
          minSimilarity: 0.60, // Lower threshold to catch paraphrasing
          maxSegmentWindow: 40,  // Widen search window for longer quotes
        });
      }

      if (match) {
        const startSegment = transcript[match.startSegmentIdx];
        const endSegment = transcript[match.endSegmentIdx];
        citations.push({
          number: index + 1,
          text: quote.text,
          start: startSegment.start,
          end: endSegment.start + endSegment.duration,
          startSegmentIdx: match.startSegmentIdx,
          endSegmentIdx: match.endSegmentIdx,
          startCharOffset: match.startCharOffset,
          endCharOffset: match.endCharOffset,
        });
      }
    }));

    // Sort citations by number
    citations.sort((a, b) => a.number - b.number);

    console.log('=== FINAL RESPONSE ===');
    console.log('Final answer:', answer);
    console.log('Final citations count:', citations.length);
    console.log('Final citations:', JSON.stringify(citations, null, 2));
    console.log('=== END FINAL RESPONSE ===');

    return NextResponse.json({ 
      content: answer,
      citations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}