import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

// Fallback keyword extraction from title and description
function extractKeywordsFromText(text: string, transcriptText: string): string[] {
  const keywords: string[] = [];
  
  // Convert to lowercase for processing
  const lowerText = text.toLowerCase();
  const lowerTranscript = transcriptText.toLowerCase();
  
  // Extract important words from title/description (nouns, verbs, adjectives)
  // Remove common stop words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'how', 
    'when', 'where', 'why', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 
    'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
    'can', 'could', 'it', 'its', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her']);
  
  // Split into words and filter
  const words = lowerText.split(/\s+/)
    .map(w => w.replace(/[^a-z0-9'-]/gi, ''))
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Check which words actually appear in the transcript
  words.forEach(word => {
    if (lowerTranscript.includes(word)) {
      keywords.push(word);
    }
  });
  
  // Try to find 2-word phrases from the title/description in the transcript
  const titleWords = text.split(/\s+/);
  for (let i = 0; i < titleWords.length - 1; i++) {
    const phrase = `${titleWords[i]} ${titleWords[i + 1]}`.toLowerCase().replace(/[^a-z0-9\s'-]/gi, '');
    if (phrase.length > 5 && lowerTranscript.includes(phrase)) {
      keywords.push(phrase);
    }
  }
  
  // Return unique keywords
  return [...new Set(keywords)].slice(0, 8);
}

interface SegmentGroup {
  start: number;
  end: number;
  texts: string[];
}

function findRelevantSegments(
  transcript: TranscriptSegment[],
  topicKeywords: string[]
): { start: number; end: number; text: string }[] {
  const segments: { start: number; end: number; text: string }[] = [];
  
  // Process keywords for better matching - preserve apostrophes and hyphens
  const processedKeywords = topicKeywords.map(k => {
    // Keep apostrophes and hyphens, but remove other special characters
    // Convert to lowercase for case-insensitive matching
    return k.toLowerCase().trim().replace(/[^a-z0-9\s'-]/gi, '');
  }).filter(k => k.length > 1); // Allow shorter keywords (>1 instead of >2)
  
  // Create variations of keywords for better matching
  const keywordVariations: string[] = [];
  processedKeywords.forEach(keyword => {
    keywordVariations.push(keyword);
    // Add version without apostrophes as a fallback
    if (keyword.includes("'")) {
      keywordVariations.push(keyword.replace(/'/g, ''));
    }
    // Add individual words from multi-word keywords
    const words = keyword.split(/\s+/);
    if (words.length > 1 && words.length <= 3) {
      words.forEach(word => {
        if (word.length > 2) keywordVariations.push(word);
      });
    }
  });
  
  console.log('Searching for keywords:', keywordVariations);
  let matchCount = 0;
  
  let currentSegment: SegmentGroup | null = null;
  
  for (const seg of transcript) {
    // Less aggressive text processing - preserve apostrophes and hyphens
    const lowerText = seg.text.toLowerCase().replace(/[^a-z0-9\s'-]/gi, '');
    
    // Check if segment is relevant - match if any keyword variation is found
    const matchedKeyword = keywordVariations.find(keyword => {
      // Try exact substring match
      if (lowerText.includes(keyword)) return true;
      
      // Try word boundary match for single words
      if (!keyword.includes(' ')) {
        const wordBoundaryRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wordBoundaryRegex.test(lowerText)) return true;
      }
      
      return false;
    });
    
    const isRelevant = !!matchedKeyword;
    
    if (isRelevant) {
      matchCount++;
      if (currentSegment && seg.start - currentSegment.end < 30) {
        // Extend current segment if close enough (within 30 seconds)
        currentSegment.end = seg.start + seg.duration;
        currentSegment.texts.push(seg.text);
      } else {
        // Save previous segment if exists
        if (currentSegment) {
          segments.push({
            start: currentSegment.start,
            end: currentSegment.end,
            text: currentSegment.texts.join(' ')
          });
        }
        // Start new segment
        currentSegment = {
          start: seg.start,
          end: seg.start + seg.duration,
          texts: [seg.text]
        };
      }
    }
  }
  
  // Save last segment if exists
  if (currentSegment) {
    segments.push({
      start: currentSegment.start,
      end: currentSegment.end,
      text: currentSegment.texts.join(' ')
    });
  }
  
  console.log(`Matched ${matchCount} transcript segments, grouped into ${segments.length} topic segments`);
  
  return segments;
}

export async function POST(request: Request) {
  try {
    const { transcript, videoId } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    const fullText = combineTranscript(transcript);
    
    // Log a sample of the transcript to help with debugging
    console.log('Analyzing transcript sample (first 200 chars):', fullText.substring(0, 200) + '...');
    console.log('Total transcript length:', fullText.length, 'characters');
    
    const systemPrompt = `You are an expert content strategist analyzing video transcripts to create distinct "highlight reels" or topics. Your goal is to identify the most valuable insights from the ACTUAL VIDEO CONTENT provided.

You must return a JSON array with this EXACT structure:
[
  {
    "title": "A complete sentence or question (max 10 words)",
    "description": "1-2 sentences explaining what this theme covers and why it's valuable",
    "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6"]
  }
]

CRITICAL KEYWORD REQUIREMENTS:
- Keywords MUST be EXACT words or phrases that appear VERBATIM in the transcript below
- Copy keywords directly from the transcript text - do not paraphrase or summarize
- Include 6-10 keywords per topic for better matching
- Mix both single words and short phrases (2-3 words max)
- Choose distinctive, topic-specific terms that appear in the transcript
- Keywords should be lowercase and exactly as they appear in the transcript
- DO NOT invent keywords that don't exist in the transcript

VALIDATION REQUIREMENT:
Before returning any topic, verify that ALL keywords you've chosen actually exist in the transcript text provided. If a keyword doesn't appear in the transcript, do not use it.

Topic requirements:
- Topics MUST be about what's actually discussed in the transcript
- Each title must relate to the actual content of the video
- Do not generate generic topics - they must be specific to this video's content`;

    const userPrompt = `Analyze this SPECIFIC video transcript and identify 4-6 core themes that are actually discussed in the video. 

IMPORTANT: Base your topics ONLY on what is actually said in this transcript. Do not make up topics about subjects that aren't discussed.

For keywords:
1. Read through the transcript text below carefully
2. Copy EXACT words and phrases that appear in the text (lowercase)
3. Verify each keyword exists in the transcript before including it
4. Choose terms that relate to each theme
5. Include both single words AND 2-3 word phrases that appear in the transcript

Transcript to analyze:
${fullText.substring(0, 10000)} // Limit to prevent token overflow

Return themes that are ACTUALLY discussed in the above transcript as a JSON array. Remember: ALL keywords must exist VERBATIM in the transcript above (case-insensitive matching is fine).`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const prompt = `${systemPrompt}

${userPrompt}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    if (!response) {
      throw new Error('No response from Gemini');
    }

    console.log('Raw Gemini response:', response);
    const parsedResponse = JSON.parse(response);
    console.log('Parsed Gemini response:', JSON.stringify(parsedResponse, null, 2));
    
    // Handle different possible response structures
    let topicsArray = parsedResponse;
    if (parsedResponse.topics && Array.isArray(parsedResponse.topics)) {
      topicsArray = parsedResponse.topics;
    } else if (parsedResponse.themes && Array.isArray(parsedResponse.themes)) {
      topicsArray = parsedResponse.themes;
    } else if (!Array.isArray(parsedResponse)) {
      console.error('Unexpected response structure:', parsedResponse);
      throw new Error('Invalid response format from Gemini - not an array');
    }
    
    console.log(`Found ${topicsArray.length} topics from Gemini`);
    
    // Validate that topics have required fields
    topicsArray.forEach((topic, index) => {
      console.log(`Topic ${index + 1} structure:`, {
        hasTitle: !!topic.title,
        hasDescription: !!topic.description,
        hasKeywords: !!topic.keywords,
        keywordCount: topic.keywords ? topic.keywords.length : 0,
        keywords: topic.keywords || []
      });
    });

    // Generate topics with segments
    const fullTranscriptText = combineTranscript(transcript);
    const topicsWithSegments = topicsArray.map((topic, index) => {
      console.log(`\nProcessing Topic ${index + 1}: "${topic.title}"`);
      
      // Use provided keywords or extract fallback keywords
      let keywords = topic.keywords || [];
      
      if (!keywords || keywords.length === 0) {
        console.log(`No keywords from Gemini, extracting fallback keywords...`);
        const combinedText = `${topic.title} ${topic.description}`;
        keywords = extractKeywordsFromText(combinedText, fullTranscriptText);
        console.log(`Extracted fallback keywords:`, keywords);
      } else {
        console.log(`Keywords from Gemini:`, keywords);
      }
      
      // Ensure we have at least some keywords to work with
      if (keywords.length === 0) {
        console.warn(`WARNING: Could not extract any keywords for topic "${topic.title}"`);
        // As a last resort, use individual words from the title
        keywords = topic.title.toLowerCase().split(/\s+/)
          .filter(w => w.length > 3)
          .slice(0, 5);
        console.log(`Using title words as last resort:`, keywords);
      }
      
      const segments = findRelevantSegments(transcript, keywords);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      console.log(`Result: Found ${segments.length} segments covering ${Math.round(totalDuration)} seconds`);
      if (segments.length === 0) {
        console.log(`WARNING: No segments matched for topic "${topic.title}"`);
        console.log(`Keywords that failed to match:`, keywords);
        // Log a sample of the transcript for debugging
        if (transcript.length > 0) {
          console.log(`Sample transcript segment: "${transcript[0].text.substring(0, 100)}..."`);
        }
      }
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description,
        duration: Math.round(totalDuration),
        segments: segments,
        keywords: keywords // Include keywords for debugging
      };
    });
    
    // Keep all topics, even those without segments (they can still be displayed)
    const topics = topicsWithSegments.length > 0 ? topicsWithSegments : 
      topicsArray.map((topic, index) => ({
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description,
        duration: 0,
        segments: []
      }));
    
    console.log(`Total topics: ${topics.length} (${topicsWithSegments.filter(t => t.segments.length > 0).length} with segments)`)

    return NextResponse.json({ topics });
  } catch (error) {
    console.error('Error generating topics:', error);
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}