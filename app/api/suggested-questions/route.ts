import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
    const { transcript, topics, model } = await request.json();

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

    const selectedModel = model && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(model) 
      ? model 
      : 'gemini-2.5-flash';

    const aiModel = genAI.getGenerativeModel({ 
      model: selectedModel,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
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
          console.log('Gemini suggested questions response:', response);
          break;
        }
      } catch (error: any) {
        console.error(`Gemini API error for suggested questions (attempt ${retryCount + 1}):`, error);
        
        if (retryCount === maxRetries) {
          console.error('Max retries reached for suggested questions');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        retryCount++;
      }
    }
    
    if (!response) {
      console.log('Using fallback questions due to no AI response');
      return NextResponse.json({ 
        questions: [
          "What are the key insights about execution speed in startups?",
          "How does agentic AI differ from traditional AI workflows?",
          "Why is learning to code still valuable in the AI era?"
        ]
      });
    }

    let questions: string[] = [];
    try {
      // First try direct JSON parse
      questions = JSON.parse(response);
      if (!Array.isArray(questions)) {
        throw new Error('Response is not an array');
      }
    } catch (parseError) {
      console.error('Failed to parse questions as JSON:', parseError);
      console.log('Attempting to extract JSON array from response...');
      
      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          questions = JSON.parse(jsonMatch[0]);
          console.log('Successfully extracted questions from response');
        } catch (extractError) {
          console.error('Failed to extract JSON array:', extractError);
          // Try to extract questions from a numbered list or line-separated format
          const lines = response.split('\n').filter(line => line.trim());
          questions = lines
            .map(line => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').replace(/^["']|["']$/g, '').trim())
            .filter(q => q.length > 0 && q.length < 100)
            .slice(0, 3);
          
          if (questions.length === 0) {
            throw new Error('Could not extract any questions from response');
          }
          console.log('Extracted questions from text format:', questions);
        }
      } else {
        throw new Error('No JSON array found in response');
      }
    }
    
    // Validate and clean questions
    questions = questions
      .filter(q => typeof q === 'string' && q.trim().length > 0)
      .map(q => q.trim())
      .slice(0, 3);
    
    if (questions.length === 0) {
      console.error('No valid questions after processing');
      questions = [
        "What are the main topics discussed in this video?",
        "Can you summarize the key points made?",
        "What are the most important takeaways?"
      ];
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