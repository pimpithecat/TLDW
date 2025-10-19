import { TranscriptSegment, VideoInfo } from "@/lib/types";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return [pad(hours), pad(minutes), pad(seconds)].join(":");
  }

  return [pad(minutes), pad(seconds)].join(":");
}

export function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments.map(segment => {
    const start = formatTime(segment.start);
    const end = formatTime(segment.start + segment.duration);
    return `[${start}-${end}] ${segment.text}`;
  }).join("\n");
}

export function formatVideoInfoBlock(videoInfo: Partial<VideoInfo> = {}): string {
  const lines: string[] = [
    `Title: ${videoInfo.title ?? "Untitled video"}`
  ];

  if (videoInfo.author) {
    lines.push(`Channel: ${videoInfo.author}`);
  }

  if (videoInfo.description) {
    lines.push(`Description: ${videoInfo.description}`);
  }

  return lines.join("\n");
}

interface BuildTakeawaysPromptParams {
  transcript: TranscriptSegment[];
  videoInfo?: Partial<VideoInfo>;
}

export function buildTakeawaysPrompt({ transcript, videoInfo }: BuildTakeawaysPromptParams): string {
  const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);
  const videoInfoBlock = formatVideoInfoBlock(videoInfo);

  return `<task>
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
}
