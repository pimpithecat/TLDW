"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipForward } from "lucide-react";
import { Topic } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

interface YouTubePlayerProps {
  videoId: string;
  selectedTopic: Topic | null;
  onTimeUpdate?: (seconds: number) => void;
  seekToTime?: number;
}

export function YouTubePlayer({
  videoId,
  selectedTopic,
  onTimeUpdate,
  seekToTime,
}: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Load YouTube IFrame API
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Initialize player when API is ready
    (window as any).onYouTubeIframeAPIReady = () => {
      playerRef.current = new (window as any).YT.Player("youtube-player", {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onStateChange: (event: any) => {
            setIsPlaying(event.data === 1);
          },
        },
      });
    };

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (seekToTime !== undefined && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekToTime, true);
    }
  }, [seekToTime]);

  // Reset segment index when topic changes
  useEffect(() => {
    setCurrentSegmentIndex(0);
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [selectedTopic]);

  const playSegments = (segmentIndex?: number) => {
    if (!selectedTopic || !playerRef.current) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const index = segmentIndex ?? currentSegmentIndex;
    const segment = selectedTopic.segments[index];
    
    if (segment) {
      playerRef.current.seekTo(segment.start, true);
      playerRef.current.playVideo();
      
      // Set up interval to check when to move to next segment
      intervalRef.current = setInterval(() => {
        if (playerRef.current?.getCurrentTime) {
          const currentTime = playerRef.current.getCurrentTime();
          if (currentTime >= segment.end) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            const nextIndex = index + 1;
            if (nextIndex < selectedTopic.segments.length) {
              setCurrentSegmentIndex(nextIndex);
              playSegments(nextIndex);
            } else {
              playerRef.current.pauseVideo();
              setCurrentSegmentIndex(0);
            }
          }
        }
      }, 1000);
    }
  };

  const skipToNextSegment = () => {
    if (!selectedTopic) return;
    const nextIndex = currentSegmentIndex + 1;
    if (nextIndex < selectedTopic.segments.length) {
      setCurrentSegmentIndex(nextIndex);
      const segment = selectedTopic.segments[nextIndex];
      playerRef.current?.seekTo(segment.start, true);
    }
  };

  return (
    <div className="w-full">
      <div className="relative pb-[56.25%] h-0">
        <div
          id="youtube-player"
          className="absolute top-0 left-0 w-full h-full rounded-lg overflow-hidden"
        />
      </div>
      
      {selectedTopic && (
        <div className="mt-4 p-4 bg-gray-100 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">Playing: {selectedTopic.title}</h4>
            <div className="text-sm text-gray-600">
              Segment {currentSegmentIndex + 1} of {selectedTopic.segments.length}
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => playSegments(0)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Play Topic Segments
                </>
              )}
            </button>
            
            {currentSegmentIndex < selectedTopic.segments.length - 1 && (
              <button
                onClick={skipToNextSegment}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
              >
                <SkipForward className="w-4 h-4" />
                Next Segment
              </button>
            )}
          </div>
          
          <div className="mt-3 space-y-1">
            {selectedTopic.segments.map((segment, index) => (
              <div
                key={index}
                className={`text-sm ${
                  index === currentSegmentIndex ? "font-bold text-blue-600" : "text-gray-600"
                }`}
              >
                {formatDuration(segment.start)} - {formatDuration(segment.end)}
                {index === currentSegmentIndex && " ← Now playing"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}