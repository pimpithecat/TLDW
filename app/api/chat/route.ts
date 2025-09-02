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

## Response Instructions
1. **Analyze**: Carefully read the user's question, previous conversation, and the full video transcript.
2. **Answer**: Formulate a direct, concise answer in Markdown format.
3. **Cite**: Identify 1-3 EXACT, VERBATIM quotes from the transcript that directly support your answer.
4. **Format**: You MUST return a single JSON object with the following structure. Do not include any other text or formatting.
   \`\`\`json
   {
     "answer": "Your markdown-formatted answer. Use placeholders like [1], [2] for citations, corresponding to the quotes array.",
     "quotes": [
       { "text": "The first exact verbatim quote from the transcript." },
       { "text": "The second exact verbatim quote." }
     ]
   }
   \`\`\`

## Content Guidelines
- Answer ONLY from the transcript provided.
- Be concise and direct. Get to the point immediately.
- Use **bold** for key terms and use bullet points for lists.

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
      parsedResponse = JSON.parse(response);
    } catch (e) {
      return NextResponse.json({ 
        content: "I couldn't generate a valid response. Please try again.",
        citations: [],
      });
    }

    const { answer, quotes } = parsedResponse;

    if (!answer || !quotes || !Array.isArray(quotes)) {
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

      const match = findTextInTranscript(transcript, quote.text, transcriptIndex, {
        strategy: 'all',
        minSimilarity: 0.80,
      });

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