import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, VideoInfo } from '@/lib/types';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateWithFallback } from '@/lib/gemini-client';
import { summaryTakeawaysSchema } from '@/lib/schemas';

type StructuredTakeaway = {
  label: string;
  insight: string;
  timestamps: string[];
};

const TAKEAWAYS_HEADING = '## Key takeaways';

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }

  return [
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0')
  ].join(':');
}

function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments.map(segment => {
    const start = formatTime(segment.start);
    const end = formatTime(segment.start + segment.duration);
    return `[${start}-${end}] ${segment.text}`;
  }).join('\n');
}

function formatVideoInfoBlock(videoInfo: Partial<VideoInfo>): string {
  const lines: string[] = [
    `Title: ${videoInfo.title ?? 'Untitled video'}`
  ];

  if (videoInfo.author) {
    lines.push(`Channel: ${videoInfo.author}`);
  }

  if (videoInfo.description) {
    lines.push(`Description: ${videoInfo.description}`);
  }

  return lines.join('\n');
}

function buildTakeawaysMarkdown(takeaways: StructuredTakeaway[]): string {
  const lines = [TAKEAWAYS_HEADING];

  for (const item of takeaways) {
    const label = item.label.trim().replace(/\s+/g, ' ');
    const insight = item.insight.trim();
    const timestamps = item.timestamps
      .map(ts => ts.trim())
      .filter(Boolean)
      .join(', ');

    const timestampSuffix = timestamps ? ` (${timestamps})` : '';
    lines.push(`- **${label}**: ${insight}${timestampSuffix}`);
  }

  return lines.join('\n');
}

async function handler(request: NextRequest) {
  try {
    const { transcript, videoInfo } = await request.json();

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

    const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript as TranscriptSegment[]);
    const videoInfoBlock = formatVideoInfoBlock(videoInfo as Partial<VideoInfo>);

    const prompt = `<task>
<role>You are an expert editorial analyst distilling a video's most potent insights for time-pressed viewers.</role>
<context>
${videoInfoBlock}
</context>
<goal>Produce 4-6 high-signal takeaways that help a viewer retain the video's core ideas.</goal>
<instructions>
  <item>Only use information stated explicitly in the transcript. Never speculate.</item>
  <item>Make each label specific, punchy, and no longer than 10 words.</item>
  <item>Write each insight as 1-2 sentences that preserve the speaker's framing.</item>
  <item>Attach 1-2 zero-padded timestamps (MM:SS or HH:MM:SS) that point to the supporting moments.</item>
  <item>Favor contrarian viewpoints, concrete examples, data, or memorable stories over generic advice.</item>
  <item>Avoid overlapping takeaways. Each one should stand alone.</item>
</instructions>
<qualityControl>
  <item>Verify every claim is grounded in transcript lines you can cite verbatim.</item>
  <item>Ensure timestamps map to the lines that justify the insight.</item>
  <item>If the transcript lacks enough high-quality insights, still return at least four by choosing the strongest available.</item>
</qualityControl>
<outputFormat>Return strict JSON with 4-6 objects: [{"label":"string","insight":"string","timestamps":["MM:SS"]}]. Do not include markdown or commentary.</outputFormat>
<transcript><![CDATA[
${transcriptWithTimestamps}
]]></transcript>
</task>`;

    let response: string;

    try {
      response = await generateWithFallback(prompt, {
        generationConfig: {
          temperature: 0.6
        },
        zodSchema: summaryTakeawaysSchema
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      throw new Error('No response from AI model');
    }

    if (!response) {
      throw new Error('No response from AI model');
    }

    let takeaways: StructuredTakeaway[];
    try {
      const parsed = JSON.parse(response);
      takeaways = summaryTakeawaysSchema.parse(parsed) as StructuredTakeaway[];
    } catch (parseError) {
      console.error('Failed to parse summary response:', parseError);
      throw new Error('Invalid response format from AI model');
    }

    if (!takeaways.length) {
      throw new Error('AI model returned no takeaways');
    }

    const markdown = buildTakeawaysMarkdown(takeaways);

    return NextResponse.json({ summaryContent: markdown });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

// Apply security with generation rate limits
export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.AUTH_GENERATION, // Use authenticated rate limit
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts
  allowedMethods: ['POST']
});
