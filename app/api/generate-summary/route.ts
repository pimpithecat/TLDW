import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment } from '@/lib/types';
import { isValidLanguage } from '@/lib/language-utils';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

function cleanMarkdownFormatting(content: string): string {
  // Fix bullet points with broken line breaks
  // Only fix when there's actual content after the newline (not another bullet or empty line)
  // Matches bullet followed by whitespace/newline and then actual text content
  content = content.replace(/([•*-])[\s]*\n(?![\s]*[•*-])(?![\s]*\n)([^\n])/g, '$1 $2');
  
  // Fix timestamps missing spaces
  // Matches timestamp format followed immediately by a letter
  content = content.replace(/(\d{1,2}:\d{2}(?::\d{2})?)([A-Za-z])/g, '$1 $2');
  
  return content;
}


export async function POST(request: Request) {
  try {
    const { transcript, videoInfo, language = 'English' } = await request.json();
    
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


    // Combine transcript into full text
    const fullTranscript = combineTranscript(transcript);
    
    // Calculate video duration for the summary (currently unused but may be needed later)
    // const lastSegment = transcript[transcript.length - 1];
    // const totalDuration = lastSegment ? lastSegment.start + lastSegment.duration : 0;
    // const durationFormatted = formatTime(totalDuration);

    // Construct the summary generation prompt
    const prompt = `# Role: Professional Video Content Transcriber and Rewriter

You are tasked with transforming a YouTube video transcript into a comprehensive "reading version." This version should be structured into thematic sections, allowing a user to fully grasp the video's content without watching it. Your output must be based **strictly** on the provided content, without adding external information or personal interpretation.

## Inputs

### Video Information

  - **Title**: ${videoInfo.title}
  - **Description**: ${videoInfo.description}
  - **Channel**: ${videoInfo.author || 'Unknown'}

### Video Transcript

\`\`\`
${fullTranscript}
\`\`\`

## Output Structure

### Context

  - **Who**: Introduce each speaker's background and relevance in 1-3 sentences. Include social media/website links if available.
  - **What**: List the key topics discussed in the video.

### Key Takeaways

  - Highlight 3-5 key lessons from the video.
  - Each point must be high-value, non-clichéd, and actionable. Avoid generic statements.
  - Append the relevant timestamp to each bullet point.

### Smart Chapters

  - Organize content modules chronologically according to the video timeline.
  - For each chapter, include:
      - A concise, one-sentence title.
      - A brief description.

### Key Quotes

  - List the top 3-5 most insightful, contrarian, memorable, or impactful quotes.
  - Use a bullet point format, including the speaker and timestamp for each quote.
  - Do not alter the original wording, but you may correct obvious transcription typos.
  - Avoid generic or bland statements.

### Stories and Anecdotes

  - Highlight 1-3 of the most intriguing, memorable, and surprising stories or anecdotes.
  - Write them as engaging bullet points.

### Mentioned Resources

  - List any books, blogs, podcasts, products, other cited shows or videos, key figures, website URLs, etc., mentioned in the video into a table in chronological order.
  - Format as a bulleted list in chronological order.
  - Use this format for each item: Item (followed by timestamp mentioned): Brief description.

## Style and Limitations
  
  - Be clear, concise and to the point. Avoid filler words and overly descriptive sentences.
  - Note that the transcript might include transcription errors; you should deduce the correct spellings from the context and output the correct versions
  - Never over-summarize!
  - Include timestamps in MM:SS or HH:MM:SS format (e.g., 05:32 or 1:45:30) for important moments
  - Do not add new facts; if ambiguous statements appear, maintain the original meaning and note the uncertainty.
  - Avoid overly long paragraphs; longer ones can be broken down into multiple logical paragraphs
  - Try to preserve the original tone and voice of the video content. When rewriting, make sure your writing is concise, engaging, and highly readable

## Language Requirement

  - Your entire output **MUST** be written in ${language}.
  - All headers, descriptions, content, etc. must be in ${language}.

## Critical Output Rules

1.  Summary Only: Your response **MUST** contain ONLY the generated summary. Do not include any conversational text, greetings, or explanations.
2.  Raw Markdown: Provide the entire output as a single block of raw markdown text.`;



    // Generate summary using Gemini
    const geminiModel = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
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
    
    // Apply formatting fixes for bullet points and timestamps
    cleanedContent = cleanMarkdownFormatting(cleanedContent);

    return NextResponse.json({ summaryContent: cleanedContent });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
