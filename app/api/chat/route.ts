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

    const prompt = `You are an expert AI assistant. Your objective is to provide concise, factual answers to a user's question based **exclusively** on a provided video transcript. You will adhere strictly to the rules and output format outlined below.

## Guiding Principles

1.  **Grounding:** Base your answer 100% on the provided transcript. Do not use any external knowledge.
2.  **Handle Missing Information:** If the transcript does not contain the information to answer the question, your \`answer\` must state that the information is not available in the transcript, and the \`quotes\` array should be empty.
3.  **Strict JSON Output:** Your entire response MUST be a single, raw JSON object. Do not include any explanatory text, markdown formatting blocks, or any other characters before or after the JSON object.

## Required JSON Output Structure

Your output must be a single JSON object with the following schema:

\`\`\`json
{
  "answer": "A markdown-formatted string that directly answers the user's question, supported by citations.",
  "quotes": [
    { "text": "A verbatim quote from the transcript." },
    { "text": "Another verbatim quote from the transcript." }
  ]
}
\`\`\`

## Detailed Instructions

### 1. \`answer\` Field Construction

  - Synthesize a direct and concise answer to the user's question.
  - Integrate numbered citation placeholders (e.g., \`[1]\`, \`[2]\`) into the answer text.
  - Each citation must correspond to the quote in the \`quotes\` array at the same index (e.g., \`[1]\` maps to the first quote, \`[2]\` to the second).
  - Ensure each citation is placed directly after the information it supports.

### 2. \`quotes\` Array Construction

  - Select quotes that directly support the claims made in your \`answer\`.
  - **Verbatim:** The \`text\` for each quote MUST be an EXACT, character-for-character copy of a passage from the transcript.
  - **Relevant:** Each quote must directly support the part of the answer where its citation is placed.
  - **Contextually Complete:** Quotes must be complete sentences and make sense on their own. Avoid partial sentences or quotes that are unintelligible without the surrounding context (e.g., a sentence that starts with "And that's why...").
  - **No Alterations:** Do not "clean up" or alter the transcript text in any way, even to fix typos or grammatical errors. Extract it exactly as it is.

## Example of a Perfect Output

\`\`\`json
{
  "answer": "AI Fund focuses on concrete ideas because they can be quickly validated or falsified [1]. This is paired with rapid engineering, which utilizes AI coding assistants to increase speed and reduce costs [2].",
  "quotes": [
    { "text": "We focus on concrete ideas, things that can be built quickly so that we can quickly validate or falsify them." },
    { "text": "We use a lot of AI coding assistants to really dramatically increase the speed of engineering and reduce the cost." }
  ]
}
\`\`\`

## Final Review Checklist

Before generating your response, perform these checks:

  - Is my entire output a single JSON object with no extra text?
  - Does my \`answer\` directly address the user's question?
  - Does every statement in my \`answer\` that requires proof have a citation \`[#]\`?
  - Does the number of citation placeholders match the total number of quotes in the \`quotes\` array?
  - Is every quote in the \`quotes\` array an exact, verbatim copy from the transcript?
  - Are all quotes complete, self-contained sentences?

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