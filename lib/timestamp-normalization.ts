/**
 * Format timestamp parts into a zero-padded string.
 */
export function formatTimestampFromParts(hours: number, minutes: number, seconds: number): string {
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

/**
 * Format seconds into a zero-padded timestamp string.
 */
export function formatTimestampFromSeconds(totalSeconds: number): string {
  const clamped = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return formatTimestampFromParts(hours, minutes, seconds);
}

/**
 * Sanitize timestamp-like strings into a canonical zero-padded format.
 */
export function sanitizeTimestamp(value: string): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/[\[\](){}【】]/g, ' ')
    .replace(/[-–]|to/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const directMatch = cleaned.match(/(\d{1,2}:\d{1,2}:\d{1,2}|\d{1,2}:\d{1,2})/);
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

function timestampCandidatesFromString(source: string): string[] {
  return source
    .split(/[,/;]|and|\s+(?=\d)/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function timestampCandidatesFromNumber(source: number): string[] {
  if (!Number.isFinite(source)) {
    return [];
  }

  return [formatTimestampFromSeconds(source)];
}

function timestampCandidatesFromObject(source: Record<string, unknown>): string[] {
  const candidates: string[] = [];

  if (typeof source.time === 'string') {
    candidates.push(source.time);
  }

  if (typeof source.timestamp === 'string') {
    candidates.push(source.timestamp);
  }

  if (typeof source.start === 'number') {
    candidates.push(formatTimestampFromSeconds(source.start));
  }

  return candidates;
}

function collectTimestampCandidates(source: unknown, depth = 0): string[] {
  if (depth > 3 || source == null) {
    return [];
  }

  if (typeof source === 'string') {
    return timestampCandidatesFromString(source);
  }

  if (typeof source === 'number') {
    return timestampCandidatesFromNumber(source);
  }

  if (Array.isArray(source)) {
    return source.flatMap(item => collectTimestampCandidates(item, depth + 1));
  }

  if (typeof source === 'object') {
    return timestampCandidatesFromObject(source as Record<string, unknown>);
  }

  return [];
}

interface NormalizeOptions {
  limit?: number;
}

/**
 * Normalize a heterogeneous list of timestamp candidates into a canonical array.
 */
export function normalizeTimestampSources(sources: unknown[], options: NormalizeOptions = {}): string[] {
  const { limit = Infinity } = options;
  const sanitized: string[] = [];

  for (const source of sources) {
    const candidates = collectTimestampCandidates(source);
    for (const candidate of candidates) {
      const normalized = sanitizeTimestamp(candidate);
      if (normalized) {
        sanitized.push(normalized);
      }
    }
  }

  const unique = Array.from(new Set(sanitized));
  return unique.slice(0, limit);
}
