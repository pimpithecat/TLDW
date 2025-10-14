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

function formatTimestampFromParts(hours: number, minutes: number, seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(hours * 3600 + minutes * 60 + seconds));
  const normalizedHours = Math.floor(totalSeconds / 3600);
  const normalizedMinutes = Math.floor((totalSeconds % 3600) / 60);
  const normalizedSeconds = totalSeconds % 60;

  if (normalizedHours > 0) {
    return [
      normalizedHours.toString().padStart(2, '0'),
      normalizedMinutes.toString().padStart(2, '0'),
      normalizedSeconds.toString().padStart(2, '0')
    ].join(':');
  }

  return [
    normalizedMinutes.toString().padStart(2, '0'),
    normalizedSeconds.toString().padStart(2, '0')
  ].join(':');
}

function sanitizeTimestamp(value: string): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/[\[\](){}【】]/g, ' ')
    .replace(/[-–]|to/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const directMatch = cleaned.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
  if (directMatch) {
    const parts = directMatch[1].split(':').map(part => parseInt(part, 10));
    if (parts.some(Number.isNaN)) {
      return null;
    }

    if (parts.length === 3) {
      return formatTimestampFromParts(parts[0], parts[1], parts[2]);
    }

    if (parts.length === 2) {
      return formatTimestampFromParts(0, parts[0], parts[1]);
    }
  }

  const hmsMatch = cleaned.match(/(?:(\d{1,2})h)?\s*(\d{1,2})m\s*(\d{1,2})s/i);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1] || '0', 10);
    const minutes = parseInt(hmsMatch[2] || '0', 10);
    const seconds = parseInt(hmsMatch[3] || '0', 10);

    if ([hours, minutes, seconds].some(Number.isNaN)) {
      return null;
    }

    return formatTimestampFromParts(hours, minutes, seconds);
  }

  const msMatch = cleaned.match(/(\d{1,2})m\s*(\d{1,2})s/i);
  if (msMatch) {
    const minutes = parseInt(msMatch[1], 10);
    const seconds = parseInt(msMatch[2], 10);
    if ([minutes, seconds].some(Number.isNaN)) {
      return null;
    }
    return formatTimestampFromParts(0, minutes, seconds);
  }

  return null;
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  return trimmed;
}

function normalizeTakeawaysPayload(payload: unknown): StructuredTakeaway[] {
  const candidateArray = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.takeaways)
      ? (payload as any).takeaways
      : Array.isArray((payload as any)?.items)
        ? (payload as any).items
        : [];

  const normalized: StructuredTakeaway[] = [];

  for (const item of candidateArray) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawLabel = typeof (item as any).label === 'string'
      ? (item as any).label
      : typeof (item as any).title === 'string'
        ? (item as any).title
        : '';

    const rawInsight = typeof (item as any).insight === 'string'
      ? (item as any).insight
      : typeof (item as any).summary === 'string'
        ? (item as any).summary
        : typeof (item as any).description === 'string'
          ? (item as any).description
          : '';

    const timestampSources: unknown[] = [];

    if (Array.isArray((item as any).timestamps)) {
      timestampSources.push(...(item as any).timestamps);
    }

    if (typeof (item as any).timestamp === 'string') {
      timestampSources.push((item as any).timestamp);
    }

    if (typeof (item as any).time === 'string') {
      timestampSources.push((item as any).time);
    }

    const sanitizedTimestamps = timestampSources
      .flatMap(source => {
        if (typeof source === 'string') {
          return source
            .split(/[,/;]|and|\s+(?=\d)/i)
            .map(part => part.trim())
            .filter(Boolean);
        }
        if (typeof source === 'number') {
          const seconds = Number.isFinite(source) ? Math.max(0, Math.floor(source)) : 0;
          return [
            formatTimestampFromParts(
              Math.floor(seconds / 3600),
              Math.floor((seconds % 3600) / 60),
              seconds % 60
            )
          ];
        }
        if (Array.isArray(source)) {
          return source.flatMap(part => {
            if (typeof part === 'string') {
              return [part];
            }
            if (typeof part === 'number') {
              const seconds = Number.isFinite(part) ? Math.max(0, Math.floor(part)) : 0;
              return [
                formatTimestampFromParts(
                  Math.floor(seconds / 3600),
                  Math.floor((seconds % 3600) / 60),
                  seconds % 60
                )
              ];
            }
            if (part && typeof part === 'object') {
              if (typeof (part as any).time === 'string') {
                return [(part as any).time];
              }
              if (typeof (part as any).timestamp === 'string') {
                return [(part as any).timestamp];
              }
              if (typeof (part as any).start === 'number') {
                const seconds = Math.max(0, Math.floor((part as any).start));
                return [
                  formatTimestampFromParts(
                    Math.floor(seconds / 3600),
                    Math.floor((seconds % 3600) / 60),
                    seconds % 60
                  )
                ];
              }
            }
            return [];
          });
        }
        if (source && typeof source === 'object') {
          if (typeof (source as any).time === 'string') {
            return [(source as any).time];
          }
          if (typeof (source as any).timestamp === 'string') {
            return [(source as any).timestamp];
          }
          if (typeof (source as any).start === 'number') {
            const seconds = Math.max(0, Math.floor((source as any).start));
            return [
              formatTimestampFromParts(
                Math.floor(seconds / 3600),
                Math.floor((seconds % 3600) / 60),
                seconds % 60
              )
            ];
          }
        }
        return [];
      })
      .map(value => sanitizeTimestamp(value))
      .filter((value): value is string => Boolean(value));

    const uniqueTimestamps = Array.from(new Set(sanitizedTimestamps)).slice(0, 2);

    const label = rawLabel.trim();
    const insight = rawInsight.trim();

    if (!label || !insight || uniqueTimestamps.length === 0) {
      continue;
    }

    normalized.push({
      label,
      insight,
      timestamps: uniqueTimestamps
    });

    if (normalized.length === 6) {
      break;
    }
  }

  return normalized;
}

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
      const cleanedResponse = extractJsonPayload(response);
      const parsed = JSON.parse(cleanedResponse);
      const normalized = normalizeTakeawaysPayload(parsed);

      const validation = summaryTakeawaysSchema.safeParse(normalized);
      if (!validation.success) {
        console.error('Normalized takeaways failed validation:', validation.error.flatten());
        throw new Error('Normalized takeaways did not match expected schema');
      }

      takeaways = validation.data as StructuredTakeaway[];
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
