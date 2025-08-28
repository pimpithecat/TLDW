import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractVideoId(url: string): string | null {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatTopicDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Generate distinct colors for topics
export function getTopicColor(index: number): { bg: string; border: string; text: string } {
  const colors = [
    { bg: 'bg-blue-100', border: 'border-blue-500', text: 'text-blue-900' },
    { bg: 'bg-purple-100', border: 'border-purple-500', text: 'text-purple-900' },
    { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-900' },
    { bg: 'bg-orange-100', border: 'border-orange-500', text: 'text-orange-900' },
    { bg: 'bg-pink-100', border: 'border-pink-500', text: 'text-pink-900' },
    { bg: 'bg-teal-100', border: 'border-teal-500', text: 'text-teal-900' },
    { bg: 'bg-indigo-100', border: 'border-indigo-500', text: 'text-indigo-900' },
    { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-900' },
    { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-900' },
    { bg: 'bg-cyan-100', border: 'border-cyan-500', text: 'text-cyan-900' },
  ];
  return colors[index % colors.length];
}

// Get HSL color for dynamic theming
export function getTopicHSLColor(index: number): string {
  const hslColors = [
    '217 91% 60%', // blue
    '262 83% 58%', // purple  
    '142 76% 36%', // green
    '25 95% 53%',  // orange
    '340 82% 59%', // pink
    '173 80% 40%', // teal
    '239 84% 67%', // indigo
    '0 72% 51%',   // red
    '43 96% 56%',  // yellow
    '192 91% 36%', // cyan
  ];
  return hslColors[index % hslColors.length];
}
