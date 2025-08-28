import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function sanitizeJsonString(str: string): string {
  try {
    // Extract JSON array
    const jsonMatch = str.match(/\[.*\]/s);
    if (!jsonMatch) return str;
    
    let cleaned = jsonMatch[0];
    
    // Remove control characters
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, ' ');
    
    // Fix unescaped quotes in strings (simple approach for array of strings)
    cleaned = cleaned.replace(/("[^"]*)(")([ \t\r\n]*[,\]])/g, '$1\\"$3');
    
    return cleaned;
  } catch (e) {
    console.error('Error in sanitizeJsonString:', e);
    return str;
  }
}

function getTranscriptSample(segments: TranscriptSegment[], maxLength: number = 3000): string {
  let sample = '';
  for (const segment of segments) {
    if (sample.length + segment.text.length > maxLength) break;
    sample += segment.text + ' ';
  }
  return sample.trim();
}

export async function POST(request: Request) {
  try {
    const { transcript, topics } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    const transcriptSample = getTranscriptSample(transcript);
    const topicsContext = topics?.map((t: Topic) => 
      `- ${t.title}: ${t.description}`
    ).join('\n') || 'No topics available';

    const prompt = `Based on this video transcript and topics, generate 3 thought-provoking questions that viewers might want to ask about the content.

## Video Topics
${topicsContext}

## Transcript Sample
${transcriptSample}

## Instructions
Generate exactly 3 questions that:
1. Are specific and relevant to the video content
2. Encourage deeper understanding of key concepts
3. Are diverse - covering different aspects or topics from the video
4. Are concise (under 15 words each)
5. Would lead to insightful answers based on the transcript

Return ONLY a JSON array with 3 question strings, no other text:
["Question 1", "Question 2", "Question 3"]`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
      }
    });

    const result = await model.generateContent(prompt);
    
    // Check if the response was blocked
    if (!result.response) {
      console.error('No response object from Gemini');
      throw new Error('No response from AI model');
    }
    
    // Check for safety blocks or other issues
    if (result.response.promptFeedback?.blockReason) {
      console.error('Response blocked:', result.response.promptFeedback);
      // Return default questions if blocked
      return NextResponse.json({ 
        questions: [
          "What are the main topics discussed in this video?",
          "Can you summarize the key points made?",
          "What are the most important takeaways?"
        ]
      });
    }
    
    let response: string;
    try {
      response = result.response.text();
    } catch (textError) {
      console.error('Failed to get text from response:', textError);
      console.log('Full response object:', JSON.stringify(result.response, null, 2));
      // Return default questions if we can't get text
      return NextResponse.json({ 
        questions: [
          "What are the main topics discussed in this video?",
          "Can you summarize the key points made?",
          "What are the most important takeaways?"
        ]
      });
    }
    
    if (!response || response.trim() === '') {
      console.error('Empty response from Gemini model');
      // Return default questions for empty responses
      return NextResponse.json({ 
        questions: [
          "What are the main topics discussed in this video?",
          "Can you summarize the key points made?",
          "What are the most important takeaways?"
        ]
      });
    }

    let questions: string[] = [];
    try {
      questions = JSON.parse(response);
      if (!Array.isArray(questions)) {
        throw new Error('Response is not an array');
      }
      questions = questions.slice(0, 3);
    } catch (e) {
      console.error('Failed to parse questions:', e);
      console.log('Attempting to sanitize and parse JSON...');
      
      try {
        const sanitized = sanitizeJsonString(response);
        questions = JSON.parse(sanitized);
        if (!Array.isArray(questions)) {
          throw new Error('Sanitized response is not an array');
        }
        questions = questions.slice(0, 3);
        console.log('Successfully parsed sanitized questions');
      } catch (e2) {
        console.error('Failed to parse sanitized JSON:', e2);
        questions = [
          "What are the main topics discussed in this video?",
          "Can you summarize the key points made?",
          "What are the most important takeaways?"
        ];
      }
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('Error generating suggested questions:', error);
    return NextResponse.json(
      { questions: [
        "What are the main topics discussed in this video?",
        "Can you summarize the key points made?",
        "What are the most important takeaways?"
      ] },
      { status: 200 }
    );
  }
}