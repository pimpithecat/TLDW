"use client";

import { useEffect, useRef, useState } from "react";
import { Play, SkipForward, SkipBack } from "lucide-react";
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
  onPlayTopic?: (topic: Topic) => void;
  transcript?: any[];
}

export function YouTubePlayer({
  videoId,
  selectedTopic,
  onTimeUpdate,
  seekToTime,
  topics = [],
  onTopicSelect,
  onPlayTopic,
  transcript = [],
}: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSeekingRef = useRef(false);
  const lastSeekTimeRef = useRef<number | undefined>(undefined);

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
              // Start time update interval with throttling
              if (timeUpdateIntervalRef.current) {
                clearInterval(timeUpdateIntervalRef.current);
              }
              
              let lastUpdateTime = 0;
              timeUpdateIntervalRef.current = setInterval(() => {
                // Skip updates while seeking to prevent feedback loops
                if (isSeekingRef.current) return;
                
                if (playerRef.current?.getCurrentTime) {
                  const time = playerRef.current.getCurrentTime();
                  
                  // Always update internal current time for progress bar
                  setCurrentTime(time);
                  
                  // Throttle external updates to reduce re-renders (update every 500ms instead of 100ms)
                  const timeDiff = Math.abs(time - lastUpdateTime);
                  if (timeDiff >= 0.5) {
                    lastUpdateTime = time;
                    onTimeUpdate?.(time);
                  }
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
      // Prevent seeking to the same position repeatedly
      if (lastSeekTimeRef.current === seekToTime) return;
      
      lastSeekTimeRef.current = seekToTime;
      isSeekingRef.current = true;
      
      playerRef.current.seekTo(seekToTime, true);
      
      // Delay time update to avoid feedback loop
      setTimeout(() => {
        if (playerRef.current?.getCurrentTime) {
          const time = playerRef.current.getCurrentTime();
          setCurrentTime(time);
          onTimeUpdate?.(time);
        }
        isSeekingRef.current = false;
        lastSeekTimeRef.current = undefined;
      }, 200);
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

  // Auto-jump monitoring for normal playback with selected topic
  useEffect(() => {
    if (!selectedTopic || !isPlaying || !playerRef.current) return;
    
    // Don't set up monitoring if playSegments/playTopic interval is already running
    if (intervalRef.current) return;
    
    // Set up monitoring interval for auto-jumping between segments
    const monitoringInterval = setInterval(() => {
      if (!playerRef.current?.getCurrentTime) return;
      
      const currentPlayTime = playerRef.current.getCurrentTime();
      
      // Find which segment we're currently in or just passed
      let currentSegIdx = -1;
      for (let i = 0; i < selectedTopic.segments.length; i++) {
        const segment = selectedTopic.segments[i];
        // Check if we're in this segment or just passed it
        if (currentPlayTime >= segment.start && currentPlayTime <= segment.end + 0.3) {
          currentSegIdx = i;
          break;
        }
      }
      
      // Check if we've reached or passed the end of a segment
      if (currentSegIdx >= 0) {
        const currentSegment = selectedTopic.segments[currentSegIdx];
        
        // If we've reached the end of this segment
        if (currentPlayTime >= currentSegment.end) {
          // Check if there's a next segment
          const nextSegmentIdx = currentSegIdx + 1;
          if (nextSegmentIdx < selectedTopic.segments.length) {
            const nextSegment = selectedTopic.segments[nextSegmentIdx];
            
            // Jump to next segment if there's a gap (segments are not contiguous)
            // Adding small tolerance for floating point comparison
            if (Math.abs(nextSegment.start - currentSegment.end) > 0.1) {
              // Clear this monitoring interval to prevent multiple jumps
              clearInterval(monitoringInterval);
              
              // Jump to next segment
              playerRef.current.seekTo(nextSegment.start, true);
              setCurrentSegmentIndex(nextSegmentIdx);
              
              // Note: A new monitoring interval will be created by this effect re-running
            }
          }
        }
      }
    }, 100); // Check every 100ms for more responsive jumping
    
    // Clean up on unmount or when dependencies change
    return () => {
      clearInterval(monitoringInterval);
    };
  }, [selectedTopic, isPlaying, currentSegmentIndex]);


  const playTopic = (topic: Topic) => {
    if (!playerRef.current || !topic) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Reset segment index for this topic
    setCurrentSegmentIndex(0);
    
    // Helper function to play a specific segment of the topic
    const playTopicSegment = (segmentIndex: number) => {
      const segment = topic.segments[segmentIndex];
      if (!segment || !playerRef.current) return;
      
      playerRef.current.seekTo(segment.start, true);
      playerRef.current.playVideo();
      
      // Set up interval to check when to move to next segment
      intervalRef.current = setInterval(() => {
        if (playerRef.current?.getCurrentTime) {
          const currentTime = playerRef.current.getCurrentTime();
          if (currentTime >= segment.end) {
            // Clear interval immediately to prevent multiple triggers
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            
            const nextIndex = segmentIndex + 1;
            if (nextIndex < topic.segments.length) {
              setCurrentSegmentIndex(nextIndex);
              // Recursively play next segment, which will seek to its start
              playTopicSegment(nextIndex);
            } else {
              // All segments played, pause the video
              playerRef.current.pauseVideo();
              setCurrentSegmentIndex(0);
            }
          }
        }
      }, 100);
    };
    
    // Start playing from the first segment
    playTopicSegment(0);
  };

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
            // Clear interval immediately to prevent multiple triggers
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            
            const nextIndex = index + 1;
            if (nextIndex < selectedTopic.segments.length) {
              setCurrentSegmentIndex(nextIndex);
              // Recursively play next segment, which will seek to its start
              playSegments(nextIndex);
            } else {
              // All segments played, pause the video
              playerRef.current.pauseVideo();
              setCurrentSegmentIndex(0);
            }
          }
        }
      }, 100);
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
    <div className="w-full">
      <Card className="overflow-hidden shadow-sm">
        <div className="relative bg-black overflow-hidden aspect-video">
          <div
            id="youtube-player"
            className="absolute top-0 left-0 w-full h-full"
          />
        </div>
      
        {/* Custom control overlay */}
        <div className="p-3 bg-background border-t flex-shrink-0">
          {/* Video progress bar */}
          {videoDuration > 0 && (
            <VideoProgressBar
              videoDuration={videoDuration}
              currentTime={currentTime}
              topics={topics}
              selectedTopic={selectedTopic}
              onSeek={handleSeek}
              onTopicSelect={onTopicSelect}
              onPlayTopic={playTopic}
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
                <span className="text-sm font-mono text-muted-foreground">
                  {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedTopic && (
                <Badge variant="secondary" className="text-xs">
                  Segment {currentSegmentIndex + 1}/{selectedTopic.segments.length}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}