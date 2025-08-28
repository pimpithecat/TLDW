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
  keywords?: string[]; // Optional for backward compatibility
  quotes?: {
    timestamp: string;
    text: string;
  }[];
}

export interface VideoData {
  videoId: string;
  title: string;
  transcript: TranscriptSegment[];
  topics: Topic[];
}

export interface Citation {
  timestamp: number;
  endTime?: number;
  text: string;
  context?: string;
  number?: number; // Citation number for inline references
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: Date;
}