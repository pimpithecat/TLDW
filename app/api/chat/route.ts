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
  
  // First, handle comma-separated timestamps by splitting them
  // Pattern to match [MM:SS, MM:SS, ...] or [MM:SS-MM:SS, MM:SS, ...]
  const commaSeparatedPattern = /\[([^\]]+)\]/g;
  const preprocessedResponse = response.replace(commaSeparatedPattern, (match, content) => {
    // Check if this contains commas (multiple timestamps)
    if (content.includes(',')) {
      // Split by comma and create individual timestamp brackets
      const timestamps = content.split(',').map((t: string) => t.trim());
      return timestamps.map((t: string) => `[${t}]`).join(' ');
    }
    // Return original if no commas
    return match;
  });
  
  // Now extract all timestamps and create citations
  const timestampPattern = /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/g;
  const timestampMatches = Array.from(preprocessedResponse.matchAll(timestampPattern));
  
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
        
        // Extract context around the timestamp from original response
        const originalIndex = response.indexOf(startTime);
        const startIndex = Math.max(0, originalIndex - 150);
        const endIndex = Math.min(response.length, originalIndex + startTime.length + 150);
        const contextText = response.substring(startIndex, endIndex).replace(/\[[^\]]+\]/g, '').trim();
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
  
  // Replace timestamps with inline citation numbers in the original response
  // First handle comma-separated timestamps
  processedContent = response.replace(commaSeparatedPattern, (match, content) => {
    if (content.includes(',')) {
      const timestamps = content.split(',').map((t: string) => t.trim());
      const citationNumbers: string[] = [];
      
      timestamps.forEach(timestamp => {
        // Parse each timestamp
        const timeMatch = timestamp.match(/(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?/);
        if (timeMatch) {
          const [, startTime, endTime] = timeMatch;
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
            citationNumbers.push(`[${citationNumber}]`);
          }
        }
      });
      
      return citationNumbers.join(' ');
    }
    
    // Handle single timestamps
    const timeMatch = content.match(/(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?/);
    if (timeMatch) {
      const [, startTime, endTime] = timeMatch;
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
    }
    
    return '';
  });
  
  // Clean up extra whitespace while preserving newlines for formatting
  // This regex replaces multiple spaces/tabs with single space but keeps newlines
  processedContent = processedContent.replace(/[^\S\n]+/g, ' ').trim();
  
  return { content: processedContent, citations };
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

    const prompt = `You are an AI assistant helping users understand a video transcript. Your role is to provide accurate, helpful answers based on the video content.

## Video Topics
${topicsContext}

## Video Transcript (with timestamps)
${transcriptContext}

## Previous Conversation
${chatHistoryContext}

## User Question
${message}

## Instructions for Response Format

### Content Structure:
1. Answer based ONLY on the video transcript provided
2. Structure your response for maximum readability:
   - Use **bold** for key terms and important concepts
   - Break content into clear paragraphs (max 3-4 sentences each)
   - Use bullet points for lists or multiple related items
   - Add section headers (##) if covering multiple aspects
   - Keep paragraphs concise and scannable

### Citation Requirements:
3. ALWAYS include inline citations using [MM:SS] format for single timestamps
4. For time ranges, use [MM:SS-MM:SS] format (e.g., [02:30-03:15])
5. NEVER use comma-separated timestamps like [MM:SS, MM:SS] - instead use separate brackets: [02:45] [03:30]
6. Place citations immediately after relevant statements: "The speaker explains [02:45]"
7. For bullet points, add citations at the end: "• Key point [01:23]"
8. When quoting, place timestamp after the quote
9. Cite multiple sections using separate brackets: "First point [02:15] and second point [05:30]"

### Response Guidelines:
10. Be concise yet comprehensive - aim for clarity over length
11. If the question cannot be answered from the transcript, state this clearly
12. Focus on the most relevant and valuable information
13. Use natural, conversational language while maintaining accuracy

### Formatting Examples:
Good: "The speaker introduces **three main concepts** [02:15]. First, they discuss..."
Good: "• **Performance optimization** involves caching [05:30]\n• **Memory management** requires careful planning [06:45]"
Bad: "The speaker talks about many things in the video and mentions several concepts..."

Provide a well-structured, easy-to-read response with proper formatting and citations.`;

    const selectedModel = model && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(model) 
      ? model 
      : 'gemini-2.5-flash';

    const maxOutputTokens = selectedModel === 'gemini-2.0-flash' ? 8192 : 65536;

    const aiModel = genAI.getGenerativeModel({ 
      model: selectedModel,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: Math.min(2048, maxOutputTokens),
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
        console.error(`Gemini API error (attempt ${retryCount + 1}):`, error);
        
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