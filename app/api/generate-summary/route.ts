import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment } from '@/lib/types';
import { isValidLanguage } from '@/lib/language-utils';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}


export async function POST(request: Request) {
  try {
    const { transcript, videoInfo, model = 'gemini-2.5-flash', language = 'English' } = await request.json();
    
    // Validate language parameter
    if (!isValidLanguage(language)) {
      return NextResponse.json(
        { error: `Invalid language specified. Supported languages: ${['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Russian', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Arabic', 'Hindi'].join(', ')}` },
        { status: 400 }
      );
    }

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    if (!videoInfo || !videoInfo.title) {
      return NextResponse.json(
        { error: 'Video information is required' },
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

    // Combine transcript into full text
    const fullTranscript = combineTranscript(transcript);
    
    // Calculate video duration for the summary (currently unused but may be needed later)
    // const lastSegment = transcript[transcript.length - 1];
    // const totalDuration = lastSegment ? lastSegment.start + lastSegment.duration : 0;
    // const durationFormatted = formatTime(totalDuration);

    // Construct the summary generation prompt
    const prompt = `You are a professional video content transcriber and rewriter. Your task is to rewrite a YouTube video into a "reading version," divided into several sections based on content themes. The goal is to allow readers to fully understand what the video is about simply by reading, as if they were reading a comprehensive summary. The output must be based on the actual content of the video, without adding any external information or personal interpretation.

## Video Information
- **Title**: ${videoInfo.title}
- **Description**: ${videoInfo.description}
- **Channel**: ${videoInfo.author || 'Unknown'}

## Video Transcript
${fullTranscript}

**Output Requirements:**

**Language Requirement:**
- Your entire output MUST be written in ${language}.
- All section titles, descriptions, and content must be in ${language}.
- Do not mix languages. Everything including headers like "Video Notes", "Context", "Key takeaways" etc. must be translated to ${language}.
- Maintain the same markdown structure but translate all text to ${language}.

**【Video Notes】**

1. **Context**
- Who: (introduce each speaker's background and what makes them noteworthy in 1-3 sentences; include their social media/website links if available)
- What: (key topics discussed)
- Why should you care: (briefly describe what the viewer can get out of this video in one sentence; make it eye-catching)

2. **Key takeaways**
Highlight the key lessons that the viewer can learn from the video in 3-5 bullet points, each followed by the timestamps where those insights appeared. Make sure the insights are high-value, non-cliched, and actionable. Avoid generic statements.

3. **Smart Chapters**
 * a. Organize the content modules chronologically according to their speaking time.
 * b. Include a one-sentence concise chapter title and a description.

4. **Key quotes**
Highlight the TOP 3-5 most insightful/contrarian/memorable/impactful/thought-provoking quotes from the video in bullet point format, with speakers and timestamps. Don't change the original wording of the quotes, but feel free to modify typos in the transcript. Avoid generic statements.

5. **Stories and anecdotes**
Highlight the 1-3 most intriguing and memorable and surprising stories/anecdotes shared by the speaker in bullet points; make them engaging. 

6. **Mentioned Resources**
 * Organize any books, blogs, podcasts, products, other cited shows or videos, key figures, website URLs, etc., mentioned in the video into a table in chronological order. 
 * a. Item (followed by timestamp mentioned)
 * b. Brief Description
 * c. Link

**Style and Limitations:**

* Note that the transcript might include transcription errors; you should deduce the correct spellings from the context and output the correct versions
* Never over-summarize!
* Include timestamps in MM:SS or HH:MM:SS format (e.g., 05:32 or 1:45:30) for important moments
* Do not add new facts; if ambiguous statements appear, maintain the original meaning and note the uncertainty.
* Avoid overly long paragraphs; longer ones can be broken down into multiple logical paragraphs
* Try to preserve the original tone and voice of the video content. When rewriting, make sure your writing is concise, engaging, and highly readable

**CRITICAL OUTPUT RULES:**
1. **Summary Only**: Your response must contain ONLY the summary. Do not include any conversational text, greetings, or explanations.
2. **Raw Markdown**: Provide the output as raw markdown text.`;

    // Generate summary using Gemini
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        temperature: 0.7
      }
    });

    const result = await geminiModel.generateContent(prompt);
    const summaryContent = result.response.text();

    if (!summaryContent) {
      throw new Error('No response from AI model');
    }

    // Clean up the response if it has any markdown code block wrappers
    let cleanedContent = summaryContent;
    if (cleanedContent.startsWith('```markdown')) {
      cleanedContent = cleanedContent.substring(11);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.substring(0, cleanedContent.length - 3);
    }
    cleanedContent = cleanedContent.trim();

    return NextResponse.json({ summaryContent: cleanedContent });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
