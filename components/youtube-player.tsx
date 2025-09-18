"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Topic, TranscriptSegment } from "@/lib/types";
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
  transcript?: TranscriptSegment[];
  isPlayingAll?: boolean;
  playAllIndex?: number;
  onTogglePlayAll?: () => void;
  setPlayAllIndex?: (index: number | ((prev: number) => number)) => void;
  setIsPlayingAll?: (playing: boolean) => void;
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
  isPlayingAll = false,
  playAllIndex = 0,
  onTogglePlayAll,
  setPlayAllIndex,
  setIsPlayingAll,
}: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [citationReelSegmentIndex, setCitationReelSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSeekingRef = useRef(false);
  const lastSeekTimeRef = useRef<number | undefined>(undefined);
  const lastAutoJumpTimeRef = useRef<number>(0);
  const lastKnownSegmentRef = useRef<number>(-1);
  const isPlayingAllRef = useRef(false);
  const playAllIndexRef = useRef(0);
  const topicsRef = useRef<Topic[]>([]);
  const currentVideoIdRef = useRef<string | null>(null);
  const isInitializingRef = useRef(false);
  
  // Keep refs in sync with state
  useEffect(() => {
    isPlayingAllRef.current = isPlayingAll;
  }, [isPlayingAll]);
  
  useEffect(() => {
    playAllIndexRef.current = playAllIndex;
  }, [playAllIndex]);
  
  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  useEffect(() => {
    // Skip if videoId hasn't changed or is being initialized
    if (currentVideoIdRef.current === videoId || isInitializingRef.current) {
      return;
    }

    // Skip if no videoId
    if (!videoId) {
      return;
    }

    isInitializingRef.current = true;
    let iframeAPIReady = false;

    // Function to initialize the player
    const initPlayer = () => {
      // Only destroy if we're changing videos
      if (playerRef.current && currentVideoIdRef.current !== videoId) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      // Update the current video ID
      currentVideoIdRef.current = videoId;

      playerRef.current = new (window as any).YT.Player("youtube-player", {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (event: { target: any }) => {
            setVideoDuration(event.target.getDuration());
            setPlayerReady(true);
            isInitializingRef.current = false;
          },
          onStateChange: (event: { data: number; target: any }) => {
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
                  
                  // Handle Play All mode auto-transitions
                  if (isPlayingAllRef.current && topicsRef.current.length > 0) {
                    const currentTopic = topicsRef.current[playAllIndexRef.current];
                    if (currentTopic && currentTopic.segments.length > 0) {
                      const segment = currentTopic.segments[0];
                      
                      // Check if we've reached the end of the current segment
                      if (time >= segment.end) {
                        // Check if this is the last topic
                        if (playAllIndexRef.current >= topicsRef.current.length - 1) {
                          // End Play All mode
                          setIsPlayingAll?.(false);
                          playerRef.current.pauseVideo();
                        } else {
                          // Advance to the next topic
                          setPlayAllIndex?.(prev => prev + 1);
                        }
                      }
                    }
                  }
                  
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

    // Check if YouTube API is already loaded
    if ((window as any).YT && (window as any).YT.Player) {
      initPlayer();
    } else {
      // Load YouTube IFrame API
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }

      // Set up callback for when API is ready
      (window as any).onYouTubeIframeAPIReady = () => {
        iframeAPIReady = true;
        initPlayer();
      };
    }

    return () => {
      // Only clean up if we're actually changing videos
      if (currentVideoIdRef.current !== videoId) {
        setPlayerReady(false);
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        if (timeUpdateIntervalRef.current) {
          clearInterval(timeUpdateIntervalRef.current);
        }
      }
      isInitializingRef.current = false;
    };
  }, [videoId]);

  useEffect(() => {
    if (seekToTime !== undefined && playerRef.current?.seekTo) {
      // Prevent seeking to the same position repeatedly
      if (lastSeekTimeRef.current === seekToTime) return;
      
      lastSeekTimeRef.current = seekToTime;
      isSeekingRef.current = true;
      
      playerRef.current.seekTo(seekToTime, true);
      
      // Auto-play after seeking (for timestamp clicks)
      if (playerRef.current?.playVideo) {
        playerRef.current.playVideo();
      }
      
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

  // Reset segment index when topic changes and auto-play if needed
  useEffect(() => {
    setCurrentSegmentIndex(0);
    setCitationReelSegmentIndex(0);
    lastKnownSegmentRef.current = -1;
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Auto-play if the topic has the autoPlay flag
    if (selectedTopic?.autoPlay && playerRef.current) {
      // Small delay to ensure player is ready
      setTimeout(() => {
        if (playerRef.current?.playVideo) {
          playerRef.current.playVideo();
        }
      }, 100);
    }
  }, [selectedTopic]);

  // State-driven playback effect for Play All mode
  useEffect(() => {
    if (!isPlayingAll || !playerReady || !playerRef.current || topics.length === 0) return;
    
    const currentTopic = topics[playAllIndex];
    if (!currentTopic || currentTopic.segments.length === 0) return;
    
    // Select the topic in the UI
    onTopicSelect?.(currentTopic);
    
    // Small delay to ensure player is ready
    setTimeout(() => {
      if (playerRef.current?.seekTo && playerRef.current?.playVideo) {
        // Seek to the start of the topic's segment and play
        const segment = currentTopic.segments[0];
        playerRef.current.seekTo(segment.start, true);
        playerRef.current.playVideo();
        setCurrentSegmentIndex(0);
      }
    }, 100);
  }, [isPlayingAll, playAllIndex, playerReady]);

  // Monitor playback to handle segment transitions and pausing
  useEffect(() => {
    if (!selectedTopic || !isPlaying || !playerRef.current) return;
    
    // Don't set up monitoring if playTopic/playSegments interval is already running
    if (intervalRef.current) return;
    
    // Don't set up monitoring during play-all mode (handled by time update logic)
    if (isPlayingAll) return;
    
    // Handle citation reels with multiple segments
    if (selectedTopic.isCitationReel && selectedTopic.segments.length > 0) {
      const monitoringInterval = setInterval(() => {
        if (!playerRef.current?.getCurrentTime) return;
        
        const currentTime = playerRef.current.getCurrentTime();
        const currentSegment = selectedTopic.segments[citationReelSegmentIndex];
        
        if (!currentSegment) return;
        
        // Check if we've reached the end of the current segment
        if (currentTime >= currentSegment.end) {
          // Check if there are more segments to play
          if (citationReelSegmentIndex < selectedTopic.segments.length - 1) {
            // Move to the next segment
            const nextIndex = citationReelSegmentIndex + 1;
            setCitationReelSegmentIndex(nextIndex);
            const nextSegment = selectedTopic.segments[nextIndex];
            
            // Seek to the start of the next segment
            playerRef.current.seekTo(nextSegment.start, true);
          } else {
            // This was the last segment, pause the video
            playerRef.current.pauseVideo();
            
            // Clear the monitoring interval
            clearInterval(monitoringInterval);
            
            // Reset the segment index for next playback
            setCitationReelSegmentIndex(0);
          }
        }
      }, 100); // Check every 100ms
      
      // Clean up on unmount or when dependencies change
      return () => {
        clearInterval(monitoringInterval);
      };
    } else {
      // Handle regular topics with single segment
      const segment = selectedTopic.segments[0];
      if (!segment) return;
      
      // Set up monitoring interval to pause at segment end
      const monitoringInterval = setInterval(() => {
        if (!playerRef.current?.getCurrentTime) return;
        
        const currentTime = playerRef.current.getCurrentTime();
        
        // Check if we're playing within the selected segment and approaching the end
        if (currentTime >= segment.start && currentTime >= segment.end) {
          // Pause the video
          playerRef.current.pauseVideo();
          
          // Clear the monitoring interval
          clearInterval(monitoringInterval);
        }
      }, 100); // Check every 100ms
      
      // Clean up on unmount or when dependencies change
      return () => {
        clearInterval(monitoringInterval);
      };
    }
  }, [selectedTopic, isPlaying, isPlayingAll, citationReelSegmentIndex]);

  const playTopic = (topic: Topic) => {
    if (!playerRef.current || !topic || topic.segments.length === 0) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // If clicking a topic manually, exit play all mode
    if (isPlayingAll) {
      setIsPlayingAll?.(false);
    }
    
    // Seek to the start of the single segment and play
    const segment = topic.segments[0];
    playerRef.current.seekTo(segment.start, true);
    playerRef.current.playVideo();
    setCurrentSegmentIndex(0);
    
    // Set up monitoring to pause at segment end
    intervalRef.current = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        const currentTime = playerRef.current.getCurrentTime();
        
        // Check if we've reached or passed the segment end
        if (currentTime >= segment.end) {
          // Clear the monitoring interval
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          
          // Only pause if not in play all mode
          playerRef.current.pauseVideo();
        }
      }
    }, 100); // Check every 100ms
  };

  const playSegments = () => {
    if (!selectedTopic || !playerRef.current || selectedTopic.segments.length === 0) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Play the single segment
    const segment = selectedTopic.segments[0];
    playerRef.current.seekTo(segment.start, true);
    playerRef.current.playVideo();
    setCurrentSegmentIndex(0);
    
    // Set up monitoring to pause at segment end
    intervalRef.current = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        const currentTime = playerRef.current.getCurrentTime();
        
        // Check if we've reached or passed the segment end
        if (currentTime >= segment.end) {
          // Pause the video
          playerRef.current.pauseVideo();
          
          // Clear the monitoring interval
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    }, 100); // Check every 100ms
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

  const playAllTopics = () => {
    // Delegate to parent component's handler
    onTogglePlayAll?.();
  };

  const selectedTopicIndex = selectedTopic ? topics.findIndex(t => t.id === selectedTopic.id) : -1;

  return (
    <div className="w-full">
      <Card className="overflow-hidden shadow-sm p-0">
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
              onPlayAllTopics={onTogglePlayAll}
              isPlayingAll={isPlayingAll}
              playAllIndex={playAllIndex}
            />
          )}

          {/* Playback controls */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="ml-3 flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">
                  {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}