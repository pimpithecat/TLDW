// Timestamp parsing and formatting utilities

// More specific regex to avoid false matches with version numbers, ratios, etc.
// Matches timestamps in context (whitespace, brackets, commas, or start/end of string)
// Updated to handle comma-separated timestamps like (12:20, 28:02)
export const TIMESTAMP_REGEX = /(?:^|\s|[\[(,])(\d{1,2}:\d{2}(?::\d{2})?)(?:[\]),]|\s|$)/g;

// Legacy regex for backward compatibility (if needed)
export const TIMESTAMP_REGEX_LEGACY = /(?:[\[(])?\b(\d{1,2}:\d{2}(?::\d{2})?)\b(?:[\])])?/g;

/**
 * Parse timestamp string (MM:SS or HH:MM:SS) to seconds
 * Returns null if timestamp is invalid
 */
export function parseTimestamp(timestamp: string): number | null {
  const regex = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
  const match = timestamp.match(regex);
  
  if (!match) return null;
  
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  
  // Validate time values
  if (hours < 0 || hours >= 24) return null;
  if (minutes < 0 || minutes >= 60) return null;
  if (seconds < 0 || seconds >= 60) return null;
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds to timestamp string (MM:SS or HH:MM:SS)
 */
export function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extract all timestamps from text
 * Returns array of { text: string, seconds: number, index: number }
 */
export function extractTimestamps(text: string): Array<{ text: string; seconds: number; index: number }> {
  const timestamps: Array<{ text: string; seconds: number; index: number }> = [];
  const regex = new RegExp(TIMESTAMP_REGEX.source, 'g');
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const timestamp = match[1];
    const seconds = parseTimestamp(timestamp);
    
    if (seconds !== null) {
      timestamps.push({
        text: match[0],
        seconds,
        index: match.index
      });
    }
  }
  
  return timestamps;
}

/**
 * Check if a string looks like a timestamp
 */
export function isTimestamp(text: string): boolean {
  const trimmed = text.trim();
  return parseTimestamp(trimmed) !== null;
}