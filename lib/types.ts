export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface Topic {
  id: string;
  title: string;
  description: string;
  duration: number;
  segments: {
    start: number;
    end: number;
    text: string;
  }[];
}

export interface VideoData {
  videoId: string;
  title: string;
  transcript: TranscriptSegment[];
  topics: Topic[];
}