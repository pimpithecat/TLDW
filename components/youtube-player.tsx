"use client";

import { useEffect, useRef, useState } from "react";
import { Topic, TranscriptSegment, PlaybackCommand, Citation } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { VideoProgressBar } from "@/components/video-progress-bar";

interface YouTubePlayerProps {
  videoId: string;
  selectedTopic: Topic | null;
  onTimeUpdate?: (seconds: number) => void;
  playbackCommand?: PlaybackCommand | null;
  onCommandExecuted?: () => void;
  onPlayerReady?: () => void;
  topics?: Topic[];
  onTopicSelect?: (topic: Topic, fromPlayAll?: boolean) => void;
  onPlayTopic?: (topic: Topic) => void;
  transcript?: TranscriptSegment[];
  isPlayingAll?: boolean;
  playAllIndex?: number;
  onTogglePlayAll?: () => void;
  setPlayAllIndex?: (index: number | ((prev: number) => number)) => void;
  setIsPlayingAll?: (playing: boolean) => void;
  renderControls?: boolean;
  onDurationChange?: (duration: number) => void;
}

export function YouTubePlayer({
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
  renderControls = true,
  onDurationChange,
}: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [citationReelSegmentIndex, setCitationReelSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playerInitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSeekingRef = useRef(false);
  const isPlayingAllRef = useRef(false);
  const playAllIndexRef = useRef(0);
  const topicsRef = useRef<Topic[]>([]);
  
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
    console.log('[YouTubePlayer] Effect triggered for videoId:', videoId);
    setVideoDuration(0);
    setCurrentTime(0);
    onDurationChange?.(0);

    if (!videoId) return;

    let mounted = true;
    let player: any = null;

    const initializePlayer = () => {
      console.log('[YouTubePlayer] initializePlayer called, mounted:', mounted, 'playerRef.current:', !!playerRef.current);
      // Only create player if component still mounted and no player exists
      if (!mounted) {
        console.log('[YouTubePlayer] Skipping init - component unmounted');
        return;
      }
      if (playerRef.current) {
        console.log('[YouTubePlayer] Skipping init - player already exists');
        return;
      }

      // Ensure IFrame element is clean for new player
      const container = document.getElementById('youtube-player');
      if (container && container.querySelector('iframe')) {
        console.log('[YouTubePlayer] Cleaning up existing IFrame before initializing new player');
        container.innerHTML = '';
      }

      console.log('[YouTubePlayer] Creating new YT.Player for videoId:', videoId);
      player = new (window as any).YT.Player("youtube-player", {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          origin: typeof window !== 'undefined' ? window.location.origin : '',
          enablejsapi: 1,
          widget_referrer: typeof window !== 'undefined' ? window.location.href : '',
        },
        events: {
          onReady: (event: { target: any }) => {
            console.log('[YouTubePlayer] onReady called, mounted:', mounted);
            
            // Get duration first before any checks
            const duration = event.target.getDuration();
            console.log('[YouTubePlayer] Video duration:', duration);
            
            // Always set duration even if component is unmounting
            // This prevents "loading timeline" from getting stuck
            if (duration && duration > 0) {
              setVideoDuration(duration);
              onDurationChange?.(duration);
            }
            
            // Then check if we should continue with player setup
            if (!mounted) {
              console.log('[YouTubePlayer] Component unmounted, skipping player setup but duration was set');
              return;
            }
            
            playerRef.current = player;
            setPlayerReady(true);
            setEmbedBlocked(false);
            setRetryCount(0);
            onPlayerReady?.();
          },
          onError: (event: { data: number }) => {
            if (!mounted) return;
            
            // Error codes: 2 = invalid param, 5 = HTML5 player error, 100 = video not found, 101/150 = embed restricted
            if (event.data === 101 || event.data === 150) {
              // Try reload once after delay for rate limiting issues
              if (retryCount < 1 && event.data === 150) {
                console.log('[YouTubePlayer] Error 150 detected, retrying in 3 seconds...');
                setRetryCount(prev => prev + 1);
                
                // Cleanup current player
                if (playerRef.current) {
                  try {
                    playerRef.current.destroy();
                  } catch (e) {
                    console.error('Error destroying player:', e);
                  }
                  playerRef.current = null;
                }
                
                // Retry after delay
                playerInitTimeoutRef.current = setTimeout(() => {
                  if (mounted) {
                    initializePlayer();
                  }
                }, 3000);
              } else {
                console.log('[YouTubePlayer] Playback restricted (error ' + event.data + ')');
                setEmbedBlocked(true);
              }
            } else {
              console.error('[YouTubePlayer] Error code:', event.data);
            }
          },
          onStateChange: (event: { data: number; target: any }) => {
            if (!mounted) return;
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
                    const currentIndex = playAllIndexRef.current;
                    const currentTopic = topicsRef.current[currentIndex];
                    if (currentTopic && currentTopic.segments.length > 0) {
                      const segment = currentTopic.segments[0];

                      // Check if we've reached the end of the current segment
                      if (time >= segment.end) {
                        const isLastTopic = currentIndex >= topicsRef.current.length - 1;
                        if (isLastTopic) {
                          // End Play All mode
                          setIsPlayingAll?.(false);
                          isPlayingAllRef.current = false;
                          playerRef.current.pauseVideo();
                        } else {
                          // Advance to the next topic
                          const nextIndex = currentIndex + 1;
                          playAllIndexRef.current = nextIndex;
                          setPlayAllIndex?.(nextIndex);
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

    // Robust YouTube API loading with polling to handle race conditions
    const waitForYouTubeAPI = () => {
      console.log('[YouTubePlayer] waitForYouTubeAPI called, YT available:', !!((window as any).YT && (window as any).YT.Player));
      if ((window as any).YT && (window as any).YT.Player) {
        initializePlayer();
        return;
      }

      // Poll for API availability (handles cases where script exists but API not ready)
      let pollAttempts = 0;
      const maxPollAttempts = 50; // 5 seconds max (50 * 100ms)
      
      console.log('[YouTubePlayer] Starting polling for YT API...');
      const pollInterval = setInterval(() => {
        pollAttempts++;
        
        if ((window as any).YT && (window as any).YT.Player) {
          console.log('[YouTubePlayer] YT API ready after', pollAttempts, 'attempts');
          clearInterval(pollInterval);
          if (mounted) initializePlayer();
        } else if (pollAttempts >= maxPollAttempts) {
          clearInterval(pollInterval);
          console.error('[YouTubePlayer] YouTube API failed to load after 5 seconds');
          setEmbedBlocked(true);
        }
      }, 100);

      // Store interval for cleanup
      playerInitTimeoutRef.current = pollInterval as any;
    };

    // Add script if it doesn't exist
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);

      // Set up callback for when script loads
      const existingCallback = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        if (existingCallback) existingCallback();
        if (mounted) initializePlayer();
      };
    } else {
      // Script exists, wait for API to be ready
      waitForYouTubeAPI();
    }

    // Cleanup: Always destroy player if it exists
    return () => {
      console.log('[YouTubePlayer] Cleanup triggered for videoId:', videoId);
      mounted = false;
      setPlayerReady(false);

      // Clear any pending initialization timeouts or polling intervals
      if (playerInitTimeoutRef.current) {
        console.log('[YouTubePlayer] Clearing pending initialization timeout/interval');
        clearTimeout(playerInitTimeoutRef.current);
        clearInterval(playerInitTimeoutRef.current as any); // Handle both timeout and interval
        playerInitTimeoutRef.current = null;
      }

      if (playerRef.current) {
        console.log('[YouTubePlayer] Destroying existing player');
        try {
          playerRef.current.destroy();
        } catch (e) {
          console.error('[YouTubePlayer] Error destroying player:', e);
        }
        playerRef.current = null;
      }
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
    };
  }, [videoId, onDurationChange]); // Only depend on videoId

  // Centralized command executor
  useEffect(() => {
    if (!playbackCommand) return;
    
    // Warn if player not ready
    if (!playerRef.current || !playerReady) {
      console.warn('[YouTubePlayer] Playback command received but player not ready:', playbackCommand.type);
      return;
    }

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
            // Play All state is already set in requestPlayAll
            // Just select the first topic and start playing
            onTopicSelect?.(topics[0], true);  // Pass true for fromPlayAll
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
    setCitationReelSegmentIndex(0);
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

    // Select the topic in the UI (with fromPlayAll flag to prevent state reset)
    onTopicSelect?.(currentTopic, true);

    // Small delay to ensure player is ready
    setTimeout(() => {
      if (playerRef.current?.seekTo && playerRef.current?.playVideo) {
        // Seek to the start of the topic's segment and play
        const segment = currentTopic.segments[0];
        playerRef.current.seekTo(segment.start, true);
        playerRef.current.playVideo();
      }
    }, 100);
  }, [isPlayingAll, playAllIndex, playerReady]);

  // Monitor playback to handle citation reel transitions
  useEffect(() => {
    if (!selectedTopic || !isPlaying || !playerRef.current) return;

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
    }
  }, [selectedTopic, isPlaying, isPlayingAll, citationReelSegmentIndex]);

  const playTopic = (topic: Topic) => {
    if (!playerRef.current || !topic || topic.segments.length === 0) return;
    
    // If clicking a topic manually, exit play all mode
    if (isPlayingAll) {
      setIsPlayingAll?.(false);
    }
    
    // Seek to the start of the single segment and play
    const segment = topic.segments[0];
    playerRef.current.seekTo(segment.start, true);
    playerRef.current.playVideo();
  };



  const handleSeek = (time: number) => {
    playerRef.current?.seekTo(time, true);
    setCurrentTime(time);
  };


  return (
    <div className="w-full">
      <Card className="overflow-hidden shadow-sm p-0">
        <div className="relative bg-black overflow-hidden aspect-video">
          {embedBlocked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-black">
              <div className="max-w-md space-y-4">
                <svg className="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <line x1="2" y1="2" x2="22" y2="22" strokeWidth={2} strokeLinecap="round" />
                </svg>
                <h3 className="text-xl font-semibold text-white">Playback Restricted</h3>
                <p className="text-gray-300 text-sm">
                  This video cannot be played here. This may be due to playback restrictions or rate limiting. You can still use all analysis features (transcript, topics, chat, notes).
                </p>
                <div className="flex flex-col gap-2">
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Watch on YouTube
                  </a>
                  <button
                    onClick={() => {
                      setEmbedBlocked(false);
                      setRetryCount(0);
                      window.location.reload();
                    }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Reload Page
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              key={videoId}
              id="youtube-player"
              className="absolute top-0 left-0 w-full h-full"
            />
          )}
        </div>
      
        {renderControls && (
          <div className="p-3 bg-background border-t flex-shrink-0">
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
                videoId={videoId}
              />
            )}

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
        )}
      </Card>
    </div>
  );
}
