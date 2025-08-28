"use client";

import { useEffect, useRef, useState } from "react";
import { Play, SkipForward, SkipBack, Volume2 } from "lucide-react";
import { Topic } from "@/lib/types";
import { formatDuration, getTopicHSLColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { VideoProgressBar } from "@/components/video-progress-bar";

interface YouTubePlayerProps {
  videoId: string;
  selectedTopic: Topic | null;
  onTimeUpdate?: (seconds: number) => void;
  seekToTime?: number;
  topics?: Topic[];
  onTopicSelect?: (topic: Topic) => void;
  transcript?: any[];
}

export function YouTubePlayer({
  videoId,
  selectedTopic,
  onTimeUpdate,
  seekToTime,
  topics = [],
  onTopicSelect,
  transcript = [],
}: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
          onReady: (event: any) => {
            setVideoDuration(event.target.getDuration());
          },
          onStateChange: (event: any) => {
            const playing = event.data === 1;
            setIsPlaying(playing);
            
            if (playing) {
              // Start time update interval
              if (timeUpdateIntervalRef.current) {
                clearInterval(timeUpdateIntervalRef.current);
              }
              timeUpdateIntervalRef.current = setInterval(() => {
                if (playerRef.current?.getCurrentTime) {
                  const time = playerRef.current.getCurrentTime();
                  setCurrentTime(time);
                  onTimeUpdate?.(time);
                }
              }, 100);
            } else {
              // Clear time update interval
              if (timeUpdateIntervalRef.current) {
                clearInterval(timeUpdateIntervalRef.current);
                timeUpdateIntervalRef.current = null;
              }
            }
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
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (seekToTime !== undefined && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekToTime, true);
      // Immediately update time when seeking
      if (playerRef.current?.getCurrentTime) {
        const time = playerRef.current.getCurrentTime();
        setCurrentTime(time);
        onTimeUpdate?.(time);
      }
    }
  }, [seekToTime, onTimeUpdate]);

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
      playerRef.current?.playVideo();
    }
  };

  const skipToPrevSegment = () => {
    if (!selectedTopic) return;
    const prevIndex = Math.max(0, currentSegmentIndex - 1);
    setCurrentSegmentIndex(prevIndex);
    const segment = selectedTopic.segments[prevIndex];
    playerRef.current?.seekTo(segment.start, true);
    playerRef.current?.playVideo();
  };

  const handleSeek = (time: number) => {
    playerRef.current?.seekTo(time, true);
    setCurrentTime(time);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      playerRef.current?.pauseVideo();
    } else {
      playerRef.current?.playVideo();
    }
  };

  const selectedTopicIndex = selectedTopic ? topics.findIndex(t => t.id === selectedTopic.id) : -1;

  return (
    <div className="w-full space-y-4">
      <Card className="overflow-hidden shadow-sm">
        <div className="relative pb-[56.25%] h-0 bg-black rounded-t-lg overflow-hidden">
          <div
            id="youtube-player"
            className="absolute top-0 left-0 w-full h-full"
          />
        </div>
      
        {/* Custom control overlay */}
        <div className="p-3 bg-background border-t">
          {/* Video progress bar */}
          {videoDuration > 0 && (
            <VideoProgressBar
              videoDuration={videoDuration}
              currentTime={currentTime}
              topics={topics}
              selectedTopic={selectedTopic}
              onSeek={handleSeek}
              onTopicSelect={onTopicSelect}
              transcript={transcript}
            />
          )}

          {/* Playback controls */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedTopic && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={skipToPrevSegment}
                    disabled={currentSegmentIndex === 0}
                    className="h-9 w-9"
                  >
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={skipToNextSegment}
                    disabled={currentSegmentIndex >= selectedTopic.segments.length - 1}
                    className="h-9 w-9"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </>
              )}

              <div className="ml-3 flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-mono text-muted-foreground">
                  {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedTopic && (
                <>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{
                      backgroundColor: `hsl(${getTopicHSLColor(selectedTopicIndex)} / 0.1)`,
                      borderColor: `hsl(${getTopicHSLColor(selectedTopicIndex)})`,
                      color: `hsl(${getTopicHSLColor(selectedTopicIndex)})`,
                    }}
                  >
                    {selectedTopic.title}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    Segment {currentSegmentIndex + 1}/{selectedTopic.segments.length}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => playSegments(0)}
                    className="ml-2"
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Play Topic
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}