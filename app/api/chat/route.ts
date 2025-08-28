import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic, ChatMessage, Citation } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function formatTranscriptForContext(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `[${timestamp}] ${s.text}`;
  }).join('\n');
}

function extractCitations(response: string, transcript: TranscriptSegment[]): {
  content: string;
  citations: Citation[];
} {
  const citations: Citation[] = [];
  let cleanContent = response;

  const timestampPattern = /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/g;
  const matches = response.matchAll(timestampPattern);

  for (const match of matches) {
    const [fullMatch, startTime, endTime] = match;
    const [startMin, startSec] = startTime.split(':').map(Number);
    const startSeconds = startMin * 60 + startSec;
    
    let endSeconds: number | undefined;
    if (endTime) {
      const [endMin, endSec] = endTime.split(':').map(Number);
      endSeconds = endMin * 60 + endSec;
    }

    const segment = transcript.find(s => 
      s.start <= startSeconds && (s.start + s.duration) >= startSeconds
    );

    if (segment) {
      const startIndex = Math.max(0, match.index! - 100);
      const endIndex = Math.min(response.length, match.index! + fullMatch.length + 200);
      const contextText = response.substring(startIndex, endIndex).replace(timestampPattern, '').trim();
      
      const words = contextText.split(' ').slice(0, 30).join(' ');
      
      citations.push({
        timestamp: startSeconds,
        endTime: endSeconds,
        text: segment.text,
        context: words,
      });
    }
  }

  cleanContent = cleanContent.replace(timestampPattern, '').trim();

  return { content: cleanContent, citations };
}

export async function POST(request: Request) {
  try {
    const { message, transcript, topics, chatHistory } = await request.json();

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

    const prompt = `You are an AI assistant helping users understand a video transcript. Your role is to provide accurate, helpful answers based on the video content.

## Video Topics
${topicsContext}

## Video Transcript (with timestamps)
${transcriptContext}

## Previous Conversation
${chatHistoryContext}

## User Question
${message}

## Instructions
1. Answer the user's question based ONLY on the video transcript provided
2. Include specific timestamps [MM:SS] when referencing parts of the video
3. If quoting or paraphrasing, indicate the relevant timestamp
4. Be concise but thorough
5. If the question cannot be answered from the transcript, say so clearly
6. When possible, cite multiple relevant sections if they provide different perspectives

Provide a clear, informative response with timestamp citations.`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      }
    });

    let response = '';
    try {
      const result = await model.generateContent(prompt);
      response = result.response?.text() || '';
    } catch (error) {
      console.error('Gemini API error:', error);
      return NextResponse.json({ 
        content: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
        citations: [],
      });
    }
    
    if (!response) {
      console.error('Empty response from Gemini model');
      return NextResponse.json({ 
        content: "I couldn't generate a response. Please try rephrasing your question.",
        citations: [],
      });
    }

    const { content, citations } = extractCitations(response, transcript);

    return NextResponse.json({ 
      content,
      citations,
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}