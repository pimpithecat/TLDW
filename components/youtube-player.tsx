"use client";

import { useEffect, useRef, useState, memo } from "react";
import { Play } from "lucide-react";
import { Topic, TranscriptSegment, PlaybackCommand, Citation } from "@/lib/types";
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
  playbackCommand?: PlaybackCommand | null;
  onCommandExecuted?: () => void;
  onPlayerReady?: () => void;
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

function YouTubePlayerComponent({
  videoId,
  selectedTopic,
  onTimeUpdate,
  playbackCommand,
  onCommandExecuted,
  onPlayerReady,
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
            // Notify parent that player is ready
            onPlayerReady?.();
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

                  // Send time updates to parent for centralized control
                  // Throttle to reduce re-renders (update every 500ms instead of 100ms)
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

  // Single centralized command executor
  useEffect(() => {
    if (!playbackCommand || !playerRef.current || !playerReady) return;

    const executeCommand = () => {
      switch (playbackCommand.type) {
        case 'SEEK':
          if (playbackCommand.time !== undefined) {
            playerRef.current.seekTo(playbackCommand.time, true);
            playerRef.current.playVideo();
          }
          break;

        case 'PLAY_TOPIC':
          if (playbackCommand.topic) {
            const topic = playbackCommand.topic;
            onTopicSelect?.(topic);
            if (topic.segments.length > 0) {
              playerRef.current.seekTo(topic.segments[0].start, true);
              if (playbackCommand.autoPlay) {
                playerRef.current.playVideo();
              }
            }
          }
          break;

        case 'PLAY_SEGMENT':
          if (playbackCommand.segment) {
            playerRef.current.seekTo(playbackCommand.segment.start, true);
            playerRef.current.playVideo();
          }
          break;

        case 'PLAY_CITATIONS':
          if (playbackCommand.citations && playbackCommand.citations.length > 0) {
            // Create citation reel topic
            const citationReel: Topic = {
              id: `citation-reel-${Date.now()}`,
              title: "Cited Clips",
              description: "Playing all clips cited in the AI response",
              duration: playbackCommand.citations.reduce((total, c) => total + (c.end - c.start), 0),
              segments: playbackCommand.citations.map(c => ({
                start: c.start,
                end: c.end,
                text: c.text,
                startSegmentIdx: c.startSegmentIdx,
                endSegmentIdx: c.endSegmentIdx,
                startCharOffset: c.startCharOffset,
                endCharOffset: c.endCharOffset,
              })),
              isCitationReel: true,
              autoPlay: true,
            };
            onTopicSelect?.(citationReel);
            playerRef.current.seekTo(playbackCommand.citations[0].start, true);
            if (playbackCommand.autoPlay) {
              playerRef.current.playVideo();
            }
          }
          break;

        case 'PLAY_ALL':
          if (topics.length > 0) {
            setIsPlayingAll?.(true);
            setPlayAllIndex?.(0);
            onTopicSelect?.(topics[0]);
            playerRef.current.seekTo(topics[0].segments[0].start, true);
            if (playbackCommand.autoPlay) {
              playerRef.current.playVideo();
            }
          }
          break;

        case 'PLAY':
          playerRef.current.playVideo();
          break;

        case 'PAUSE':
          playerRef.current.pauseVideo();
          break;
      }

      // Clear command after execution
      onCommandExecuted?.();
    };

    // Execute with small delay to ensure player stability
    const timeoutId = setTimeout(executeCommand, 50);
    return () => clearTimeout(timeoutId);
  }, [playbackCommand, playerReady, topics, onCommandExecuted, onTopicSelect, setIsPlayingAll, setPlayAllIndex]);

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

  // Removed segment monitoring - now handled by parent component via time updates

  // Removed playTopic and playSegments - all playback now controlled via commands


  const handleSeek = (time: number) => {
    playerRef.current?.seekTo(time, true);
    setCurrentTime(time);
  };

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
              onPlayTopic={onPlayTopic}
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

// Memoize the component to prevent unnecessary re-renders
// Only re-render when videoId changes or when critical props change
export const YouTubePlayer = memo(YouTubePlayerComponent, (prevProps, nextProps) => {
  // Custom comparison function - return true to prevent re-render
  // Only re-render if:
  // - videoId changes
  // - selectedTopic changes (by reference)
  // - playbackCommand changes
  // - topics array changes (by reference)
  // - isPlayingAll state changes
  // - playAllIndex changes

  return (
    prevProps.videoId === nextProps.videoId &&
    prevProps.selectedTopic === nextProps.selectedTopic &&
    prevProps.playbackCommand === nextProps.playbackCommand &&
    prevProps.topics === nextProps.topics &&
    prevProps.isPlayingAll === nextProps.isPlayingAll &&
    prevProps.playAllIndex === nextProps.playAllIndex &&
    prevProps.transcript === nextProps.transcript &&
    // Compare function references - these should be stable with useCallback
    prevProps.onTimeUpdate === nextProps.onTimeUpdate &&
    prevProps.onTopicSelect === nextProps.onTopicSelect &&
    prevProps.onTogglePlayAll === nextProps.onTogglePlayAll &&
    prevProps.setPlayAllIndex === nextProps.setPlayAllIndex &&
    prevProps.setIsPlayingAll === nextProps.setIsPlayingAll &&
    prevProps.onCommandExecuted === nextProps.onCommandExecuted &&
    prevProps.onPlayerReady === nextProps.onPlayerReady
  );
});

// Add display name for debugging
YouTubePlayer.displayName = 'YouTubePlayer';