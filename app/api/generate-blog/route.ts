import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, VideoInfo } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}


export async function POST(request: Request) {
  try {
    const { transcript, videoInfo, videoId, model = 'gemini-2.5-flash' } = await request.json();

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
    
    // Calculate video duration for the blog post
    const lastSegment = transcript[transcript.length - 1];
    const totalDuration = lastSegment ? lastSegment.start + lastSegment.duration : 0;
    const durationFormatted = formatTime(totalDuration);

    // Construct the blog generation prompt
    const prompt = `You are a professional video content transcriber and rewriter. Your task is to rewrite a YouTube video into a "reading version," divided into several sections based on content themes. The goal is to allow readers to fully understand what the video is about simply by reading, as if they were reading a blog post. The output must be based on the actual content of the video, without adding any external information or personal interpretation.

## Video Information
- **Title**: ${videoInfo.title}
- **Author**: ${videoInfo.author || 'Unknown'}
- **Duration**: ${durationFormatted}

## Video Transcript
${fullTranscript}

**Output Requirements:**

**【Video Notes】**

1. **YouTube Info** 
  * Title | Author (include social media links if available) 
2. **One-Sentence Summary** 
  * Use one paragraph to highlight the core thesis and conclusion of the main speaker(s) in the video. 
3. **Video Thematic Breakdown** 
  * a. Divide the video content into several sections based on logical themes (e.g., according to the video's natural paragraphs or topic shifts). The title of each section should be concise and reflect the core theme of that section. 
  * b. Within each section, provide a detailed and exhaustive description based on the video's content, including key details, examples, explanations, and dialogue mentioned. Ensure the description is detailed enough for a reader to fully understand that part of the content without watching the video. 
  * c. If the video presents methods, frameworks, or processes, rewrite them into clearly structured steps or paragraphs, using bullet points for organization. 
  * d. If there are key numbers, definitions, direct quotes, or citations, preserve the core words faithfully and add brief annotations in parentheses. 
  * e. Avoid overly long paragraphs; if logically divisible, break them down into multiple paragraphs or use bullet points. 
  * f. Include the video timestamp for each referenced section.

**【Content Framework Output (Framework & Mindset)】**

* Abstract any frameworks and mindsets from the video and rewrite them into clearly structured steps or paragraphs. Each framework & mindset should be output in its entirety, preferably over 500 words (do not display this requirement in the output text). For long content, ensure it is divided into smaller paragraphs. Do not omit anything. 
* Pay attention to reasonable paragraph division for mental models to reduce reading fatigue.

**【Smart Chapters】**

5. **Video Timeline Breakdown (Smart Chapters)** 
  * a. Organize the content modules chronologically according to their speaking time. 
  * b. Include a one-sentence concise chapter title and a brief, detailed description.

**【References】**

6. **Mentioned Resources** 
  * Organize any books, blogs, podcasts, other cited shows or videos, key figures, website URLs, etc., mentioned in the video into a table in chronological order. 
  * a. Item 
  * b. Brief Description 
  * c. Link

**Style and Limitations:**

* All the above content should be presented with clean and clear Markdown sections, paying attention to title hierarchy. 
* Never over-summarize! 
* Do not add new facts; if ambiguous statements appear, maintain the original meaning and note the uncertainty. 
* Preserve original proper nouns, and provide Chinese translations in parentheses (if they appear in the transcript or can be directly translated). 
* Avoid overly long paragraphs; longer ones can be broken down into multiple logical paragraphs (using bullet points). 
* Use a writing style and vocabulary that is as close as possible to the original video, appropriately combined with a Medium blog style. 
* Do not include the instructional text from these requirements in the final output.`;

    // Generate blog post using Gemini
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        temperature: 0.7
      }
    });

    const result = await geminiModel.generateContent(prompt);
    const blogContent = result.response.text();

    if (!blogContent) {
      throw new Error('No response from AI model');
    }

    // Clean up the response if it has any markdown code block wrappers
    let cleanedContent = blogContent;
    if (cleanedContent.startsWith('```markdown')) {
      cleanedContent = cleanedContent.substring(11);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.substring(0, cleanedContent.length - 3);
    }
    cleanedContent = cleanedContent.trim();

    return NextResponse.json({ blogContent: cleanedContent });
  } catch (error) {
    console.error('Error generating blog post:', error);
    return NextResponse.json(
      { error: 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}