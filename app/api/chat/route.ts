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
  const citationMap = new Map<number, Citation>();
  let processedContent = response;
  
  // First, extract all timestamps and create citations
  const timestampPattern = /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/g;
  const timestampMatches = Array.from(response.matchAll(timestampPattern));
  
  // Track citation numbers for each unique timestamp
  const timestampToCitationNumber = new Map<string, number>();
  let citationCounter = 1;
  
  timestampMatches.forEach(match => {
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
      const timestampKey = `${startSeconds}-${endSeconds || ''}`;
      
      if (!timestampToCitationNumber.has(timestampKey)) {
        const citationNumber = citationCounter++;
        timestampToCitationNumber.set(timestampKey, citationNumber);
        
        // Extract context around the timestamp
        const startIndex = Math.max(0, match.index! - 150);
        const endIndex = Math.min(response.length, match.index! + fullMatch.length + 150);
        const contextText = response.substring(startIndex, endIndex).replace(timestampPattern, '').trim();
        const words = contextText.split(' ').slice(0, 40).join(' ');
        
        const citation: Citation = {
          timestamp: startSeconds,
          endTime: endSeconds,
          text: segment.text,
          context: words,
          number: citationNumber,
        };
        
        citationMap.set(citationNumber, citation);
        citations.push(citation);
      }
    }
  });
  
  // Replace timestamps with inline citation numbers
  processedContent = response.replace(timestampPattern, (match, startTime, endTime) => {
    const [startMin, startSec] = startTime.split(':').map(Number);
    const startSeconds = startMin * 60 + startSec;
    
    let endSeconds: number | undefined;
    if (endTime) {
      const [endMin, endSec] = endTime.split(':').map(Number);
      endSeconds = endMin * 60 + endSec;
    }
    
    const timestampKey = `${startSeconds}-${endSeconds || ''}`;
    const citationNumber = timestampToCitationNumber.get(timestampKey);
    
    if (citationNumber) {
      return `[${citationNumber}]`;
    }
    return '';
  });
  
  // Clean up any extra whitespace
  processedContent = processedContent.replace(/\s+/g, ' ').trim();
  
  return { content: processedContent, citations };
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
2. IMPORTANT: Include inline citations by adding [MM:SS] timestamps directly after each sentence or claim that references the video
3. Place citations immediately after the relevant statement, like this: "The speaker explains the concept [02:45] and provides an example [03:12]."
4. For bullet points, add the citation at the end of each point: "• First point about X [01:23]"
5. When quoting directly, place the timestamp right after the quote
6. Be concise but thorough
7. If the question cannot be answered from the transcript, say so clearly
8. Cite multiple relevant sections when they provide different perspectives
9. Always prefer inline citations over listing them at the end

Format your response with citations embedded naturally in the text, not as a separate section.`;

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