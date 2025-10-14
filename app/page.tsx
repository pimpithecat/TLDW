"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { UrlInput } from "@/components/url-input";
import { RightColumnTabs, type RightColumnTabsHandle } from "@/components/right-column-tabs";
import { YouTubePlayer } from "@/components/youtube-player";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { VideoSkeleton } from "@/components/video-skeleton";
import Image from "next/image";
import { Topic, TranscriptSegment, VideoInfo, Citation, PlaybackCommand } from "@/lib/types";

// Playback context for tracking what's currently playing
interface PlaybackContext {
  type: 'TOPIC' | 'CITATIONS' | 'PLAY_ALL';
  endTime: number;
  topicId?: string;
  playAllIndex?: number;
  segments?: { start: number; end: number }[];
  currentSegmentIndex?: number;
}

// Page state for better UX
type PageState = 'IDLE' | 'ANALYZING_NEW' | 'LOADING_CACHED';
import { extractVideoId } from "@/lib/utils";
import { useElapsedTimer } from "@/lib/hooks/use-elapsed-timer";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AuthModal } from "@/components/auth-modal";
import { useAuth } from "@/contexts/auth-context";
import { backgroundOperation, AbortManager } from "@/lib/promise-utils";
import { toast } from "sonner";

export default function Home() {
  const [pageState, setPageState] = useState<PageState>('IDLE');
  const hasAttemptedLinking = useRef(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating' | 'processing' | null>(null);
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Centralized playback control state
  const [playbackCommand, setPlaybackCommand] = useState<PlaybackCommand | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playbackContext, setPlaybackContext] = useState<PlaybackContext | null>(null);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [citationHighlight, setCitationHighlight] = useState<Citation | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const rightColumnTabsRef = useRef<RightColumnTabsHandle>(null);
  const lastSeekTimeRef = useRef<number>(0);
  const abortManager = useRef(new AbortManager());

  // Play All state (lifted from YouTubePlayer)
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);

  // Memoized setters for Play All state
  const memoizedSetPlayAllIndex = useCallback((value: number | ((prev: number) => number)) => {
    setPlayAllIndex(value);
  }, []);

  const memoizedSetIsPlayingAll = useCallback((value: boolean) => {
    setIsPlayingAll(value);
  }, []);
  
  // Takeaways generation state
  const [takeawaysContent, setTakeawaysContent] = useState<string | null>(null);
  const [isGeneratingTakeaways, setIsGeneratingTakeaways] = useState<boolean>(false);
  const [takeawaysError, setTakeawaysError] = useState<string>("");
  const [showTakeawaysTab, setShowTakeawaysTab] = useState<boolean>(false);

  // Cached suggested questions
  const [cachedSuggestedQuestions, setCachedSuggestedQuestions] = useState<string[] | null>(null);

  // Use custom hook for timer logic
  const elapsedTime = useElapsedTimer(generationStartTime);
  const processingElapsedTime = useElapsedTimer(processingStartTime);

  // Auth and generation limit state
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    remaining: number;
    resetAt: Date | null;
  }>({ remaining: -1, resetAt: null });

  // Memoize processVideo to prevent infinite loops
  const processVideoMemo = useCallback((url: string, isCached: boolean = false) => {
    processVideo(url, isCached);
  }, []);

  // Centralized playback request functions
  const requestSeek = useCallback((time: number) => {
    if (!isPlayerReady) return;
    // Clear playback context for direct seeks
    setPlaybackContext(null);
    setPlaybackCommand({ type: 'SEEK', time });
  }, [isPlayerReady]);

  const requestPlayTopic = useCallback((topic: Topic) => {
    if (!isPlayerReady) return;
    // Track that we're initiating a seek
    lastSeekTimeRef.current = Date.now();
    // Set playback context for segment-end detection
    if (topic.segments.length > 0) {
      setPlaybackContext({
        type: 'TOPIC',
        endTime: topic.segments[topic.segments.length - 1].end,
        topicId: topic.id,
        segments: topic.segments,
        currentSegmentIndex: 0
      });
    }
    setPlaybackCommand({ type: 'PLAY_TOPIC', topic, autoPlay: true });
  }, [isPlayerReady]);

  const requestPlaySegment = useCallback((segment: TranscriptSegment) => {
    if (!isPlayerReady) return;
    setPlaybackCommand({ type: 'PLAY_SEGMENT', segment });
  }, [isPlayerReady]);

  const requestPlayCitations = useCallback((citations: Citation[]) => {
    if (!isPlayerReady) return;
    // Track that we're initiating a seek
    lastSeekTimeRef.current = Date.now();
    // Set playback context for citation segments
    if (citations.length > 0) {
      setPlaybackContext({
        type: 'CITATIONS',
        endTime: citations[citations.length - 1].end,
        segments: citations.map(c => ({ start: c.start, end: c.end })),
        currentSegmentIndex: 0
      });
    }
    setPlaybackCommand({ type: 'PLAY_CITATIONS', citations, autoPlay: true });
  }, [isPlayerReady]);

  const requestPlayAll = useCallback(() => {
    if (!isPlayerReady || topics.length === 0) return;
    // Track that we're initiating a seek
    lastSeekTimeRef.current = Date.now();
    // Set Play All state first
    setIsPlayingAll(true);
    setPlayAllIndex(0);
    // Set playback context for play all mode
    setPlaybackContext({
      type: 'PLAY_ALL',
      endTime: topics[0].segments[0].end,
      playAllIndex: 0
    });
    setPlaybackCommand({ type: 'PLAY_ALL', autoPlay: true });
  }, [isPlayerReady, topics]);

  const clearPlaybackCommand = useCallback(() => {
    setPlaybackCommand(null);
  }, []);

  const handlePlayerReady = useCallback(() => {
    setIsPlayerReady(true);
  }, []);

  // Store current video data in sessionStorage before auth
  const storeCurrentVideoForAuth = () => {
    if (videoId && !user) {
      sessionStorage.setItem('pendingVideoId', videoId);
      console.log('Stored video for post-auth linking:', videoId);
    }
  };

  // Check for pending video linking after auth
  const checkPendingVideoLink = async (retryCount = 0) => {
    // Check both sessionStorage and current videoId state
    const pendingVideoId = sessionStorage.getItem('pendingVideoId');
    const currentVideoId = videoId;
    const videoToLink = pendingVideoId || currentVideoId;

    console.log('Checking for video to link:', {
      pendingVideoId,
      currentVideoId,
      user: user?.email,
      retryCount
    });

    if (videoToLink && user) {
      console.log('Found video to link:', videoToLink);

      // First, check if the video exists in the database
      try {
        // Construct YouTube URL from videoId for the cache check
        const checkUrl = `https://www.youtube.com/watch?v=${videoToLink}`;
        const checkResponse = await fetch('/api/check-video-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: checkUrl })
        });

        if (!checkResponse.ok || !(await checkResponse.json()).cached) {
          // Video doesn't exist yet, don't try to link
          console.log('Video not yet in database, skipping link');
          return;
        }
      } catch (error) {
        console.error('Error checking video cache:', error);
        return;
      }

      try {
        const response = await fetch('/api/link-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: videoToLink })
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Link video response:', data);
          // Only show toast for newly linked videos, not already linked ones
          if (!data.alreadyLinked) {
            toast.success('Video saved to your library!');
          }
          sessionStorage.removeItem('pendingVideoId');
        } else if (response.status === 404 && retryCount < 3) {
          // Retry with exponential backoff if video not found
          console.log(`Video not found, retrying in ${1000 * (retryCount + 1)}ms...`);
          setTimeout(() => {
            checkPendingVideoLink(retryCount + 1);
          }, 1000 * (retryCount + 1));
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('Failed to link video:', errorData);
          // Don't remove pendingVideoId on error, so it can be retried later
        }
      } catch (error) {
        console.error('Error linking video:', error);
      }
    }
  };

  // Check rate limit status on mount
  useEffect(() => {
    checkRateLimit();
  }, []);

  // Handle pending video linking when user logs in and videoId is available
  useEffect(() => {
    if (user && !hasAttemptedLinking.current && (videoId || sessionStorage.getItem('pendingVideoId'))) {
      hasAttemptedLinking.current = true;
      // Delay the link attempt to ensure authentication is fully propagated
      setTimeout(() => {
        checkPendingVideoLink();
      }, 1500);
    }
  }, [user, videoId]); // Properly track both dependencies

  // Cleanup AbortManager on component unmount
  useEffect(() => {
    const currentAbortManager = abortManager.current;
    return () => {
      // Abort all pending requests when component unmounts
      currentAbortManager.cleanup();
    };
  }, []);

  const checkRateLimit = async () => {
    try {
      const response = await fetch('/api/check-limit');
      const data = await response.json();
      if (data.remaining !== undefined) {
        setRateLimitInfo({
          remaining: data.remaining,
          resetAt: data.resetAt ? new Date(data.resetAt) : null
        });
      }
    } catch (error) {
      console.error('Error checking rate limit:', error);
    }
  };

  // Check for URL params on mount (separate effect to prevent loops)
  useEffect(() => {
    // Check for auth error in URL params
    const urlParams = new URLSearchParams(window.location.search);
    const authError = urlParams.get('auth_error');

    if (authError) {
      toast.error(`Authentication failed: ${decodeURIComponent(authError)}`);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    // Check for video ID in URL params (for loading cached videos)
    const videoIdParam = urlParams.get('v');
    const cachedParam = urlParams.get('cached');

    if (videoIdParam && cachedParam === 'true' && pageState === 'IDLE' && !videoId) {
      // Store video ID for potential post-auth linking before loading
      if (!user) {
        sessionStorage.setItem('pendingVideoId', videoIdParam);
        console.log('Stored URL param video ID for potential post-auth linking:', videoIdParam);
      }
      // Load cached video directly with isCached flag
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoIdParam}`;
      processVideoMemo(youtubeUrl, true);
    }
  }, []); // Empty dependency array - only run once on mount

  // Check if user can generate based on server-side rate limits
  const checkGenerationLimit = (): boolean => {
    if (user) return true; // Authenticated users have higher limits

    if (rateLimitInfo.remaining === 0) {
      // Show auth modal when rate limited
      setAuthModalOpen(true);
      toast.error('Daily limit reached. Sign in for more generations!');
      return false;
    }
    return true;
  };

  const processVideo = async (url: string, isCached: boolean = false) => {
    // Check generation limit for anonymous users
    if (!checkGenerationLimit()) {
      // Store current video before showing auth modal
      if (videoId) {
        storeCurrentVideoForAuth();
      }
      return;
    }

    // Cleanup any pending requests from previous analysis
    abortManager.current.cleanup();

    // For cached videos, skip the analyzing state and go directly to loading
    if (isCached) {
      setPageState('LOADING_CACHED');
    } else {
      setPageState('ANALYZING_NEW');
      setLoadingStage('fetching');
    }

    setError("");
    setTopics([]);
    setTranscript([]);
    setSelectedTopic(null);
    setCitationHighlight(null);
    setVideoInfo(null);
    setVideoPreview("");

    // Reset takeaways-related states
    setTakeawaysContent(null);
    setTakeawaysError("");
    setShowTakeawaysTab(false);

    // Reset cached suggested questions
    setCachedSuggestedQuestions(null);

    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }

      // Store video ID immediately for potential post-auth linking
      if (!user) {
        sessionStorage.setItem('pendingVideoId', extractedVideoId);
        console.log('Stored video ID for potential post-auth linking:', extractedVideoId);
      }

      // Only set videoId if it's different to prevent unnecessary re-renders
      if (videoId !== extractedVideoId) {
        setVideoId(extractedVideoId);
      }

      // Check cache first before fetching transcript/metadata
      const cacheResponse = await fetch("/api/check-video-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (cacheResponse.ok) {
        const cacheData = await cacheResponse.json();

        if (cacheData.cached) {
          // For cached videos, we're already in LOADING_CACHED state if isCached was true
          // Otherwise, set it now
          if (!isCached) {
            setPageState('LOADING_CACHED');
          }

          // Load all cached data
          setTranscript(cacheData.transcript);
          setVideoInfo(cacheData.videoInfo);
          setTopics(cacheData.topics);

          // Set cached takeaways and questions
          if (cacheData.summary) {
            setTakeawaysContent(cacheData.summary);
            setShowTakeawaysTab(true);
            setIsGeneratingTakeaways(false);
          }
          if (cacheData.suggestedQuestions) {
            setCachedSuggestedQuestions(cacheData.suggestedQuestions);
          }

          // Store video ID for potential post-auth linking (for cached videos)
          if (!user) {
            sessionStorage.setItem('pendingVideoId', extractedVideoId);
            console.log('Stored cached video ID for potential post-auth linking:', extractedVideoId);
          }

          // Set page state back to idle
          setPageState('IDLE');
          setLoadingStage(null);
          setProcessingStartTime(null);

          // Auto-start takeaways generation if not available
          if (!cacheData.summary) {
            setShowTakeawaysTab(true);
            setIsGeneratingTakeaways(true);

            backgroundOperation(
              'generate-cached-takeaways',
              async () => {
                const summaryRes = await fetch("/api/generate-summary", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  transcript: cacheData.transcript,
                  videoInfo: cacheData.videoInfo,
                  videoId: extractedVideoId
                }),
                });

                if (summaryRes.ok) {
                  const { summaryContent: generatedTakeaways } = await summaryRes.json();
                  setTakeawaysContent(generatedTakeaways);

                  // Update the video analysis with the takeaways
                  await backgroundOperation(
                    'update-cached-takeaways',
                    async () => {
                      await fetch("/api/update-video-analysis", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          videoId: extractedVideoId,
                          summary: generatedTakeaways
                        }),
                      });
                    }
                  );
                  return generatedTakeaways;
                } else {
                  const errorData = await summaryRes.json().catch(() => ({ error: "Unknown error" }));
                  throw new Error(errorData.error || "Failed to generate takeaways");
                }
              },
              (error) => {
                setTakeawaysError(error.message || "Failed to generate takeaways. Please try again.");
              }
            ).finally(() => {
              setIsGeneratingTakeaways(false);
            });
          }

          return; // Exit early - no need to fetch anything else
        }
      }

      // Not cached, proceed with normal flow
      // Create AbortControllers for both requests
      const transcriptController = abortManager.current.createController('transcript', 30000);
      const videoInfoController = abortManager.current.createController('videoInfo', 10000);

      // Fetch transcript and video info in parallel
      const transcriptPromise = fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: transcriptController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          throw new Error("Transcript request timed out. Please try again.");
        }
        throw new Error("Network error: Unable to fetch transcript. Please ensure the server is running.");
      });

      const videoInfoPromise = fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: videoInfoController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          console.error("Video info request timed out");
          return null;
        }
        console.error("Failed to fetch video info:", err);
        return null;
      });

      // Wait for both requests to complete
      const [transcriptRes, videoInfoRes] = await Promise.all([
        transcriptPromise,
        videoInfoPromise
      ]);

      // AbortManager handles timeout cleanup automatically

      // Process transcript response (required)
      if (!transcriptRes || !transcriptRes.ok) {
        const errorData = transcriptRes ? await transcriptRes.json().catch(() => ({ error: "Unknown error" })) : { error: "Failed to fetch transcript" };
        throw new Error(errorData.error || "Failed to fetch transcript");
      }

      const { transcript: fetchedTranscript } = await transcriptRes.json();
      setTranscript(fetchedTranscript);

      // Process video info response (optional)
      let fetchedVideoInfo = null;
      if (videoInfoRes && videoInfoRes.ok) {
        try {
          const videoInfoData = await videoInfoRes.json();
          if (videoInfoData && !videoInfoData.error) {
            setVideoInfo(videoInfoData);
            fetchedVideoInfo = videoInfoData;
          }
        } catch (error) {
          console.error("Failed to parse video info:", error);
        }
      }

      // Move to understanding stage
      setLoadingStage('understanding');
      
      // Generate quick preview (non-blocking)
      fetch("/api/quick-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: fetchedTranscript,
          videoTitle: fetchedVideoInfo?.title,
          videoDescription: fetchedVideoInfo?.description,
          channelName: fetchedVideoInfo?.author,
          tags: fetchedVideoInfo?.tags
        }),
      })
        .then(res => {
          if (!res.ok) {
            console.error('Quick preview generation failed:', res.status);
            return null;
          }
          return res.json();
        })
        .then(data => {
          if (data && data.preview) {
            console.log('Quick preview generated:', data.preview);
            setVideoPreview(data.preview);
          }
        })
        .catch((error) => {
          console.error('Error generating quick preview:', error);
        });
      
      // Initiate parallel API requests for topics and takeaways
      setLoadingStage('generating');
      setGenerationStartTime(Date.now());

      // Create abort controllers for both requests
      const topicsController = abortManager.current.createController('topics', 60000);
      const takeawaysController = abortManager.current.createController('takeaways', 60000);

      // Start topics generation using cached video-analysis endpoint
      const topicsPromise = fetch("/api/video-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: extractedVideoId,
          videoInfo: fetchedVideoInfo,
          transcript: fetchedTranscript,
          model: 'gemini-2.5-flash'
        }),
        signal: topicsController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          throw new Error("Topic generation timed out. The video might be too long. Please try a shorter video.");
        }
        throw new Error("Network error: Unable to generate topics. Please check your connection.");
      });

      // Start takeaways generation in parallel (will be ignored if cached)
      const takeawaysPromise = fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: fetchedTranscript,
          videoInfo: fetchedVideoInfo,
          videoId: extractedVideoId
        }),
        signal: takeawaysController.signal,
      });

      // Show takeaways tab and loading state immediately (optimistic UI)
      setShowTakeawaysTab(true);
      setIsGeneratingTakeaways(true);

      // Wait for both to complete using Promise.allSettled
      const [topicsResult, takeawaysResult] = await Promise.allSettled([
        topicsPromise,
        takeawaysPromise
      ]);

      // Move to processing stage
      setLoadingStage('processing');
      setGenerationStartTime(null);
      setProcessingStartTime(Date.now());

      // Process topics result
      let generatedTopics = null;
      if (topicsResult.status === 'fulfilled') {
        const topicsRes = topicsResult.value;

        if (!topicsRes.ok) {
          const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || "Failed to generate topics");
        }

        const topicsData = await topicsRes.json();
        generatedTopics = topicsData.topics;
      } else {
        throw topicsResult.reason;
      }

      // Process takeaways result from parallel execution
      let generatedTakeaways = null;
      let takeawaysGenerationError = null;
      if (takeawaysResult.status === 'fulfilled') {
        const summaryRes = takeawaysResult.value;

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          generatedTakeaways = summaryData.summaryContent;
        } else {
          const errorData = await summaryRes.json().catch(() => ({ error: "Unknown error" }));
          takeawaysGenerationError = errorData.error || "Failed to generate takeaways. Please try again.";
        }
      } else {
        const error = takeawaysResult.reason;
        if (error && error.name === 'AbortError') {
          takeawaysGenerationError = "Takeaways generation timed out. The video might be too long.";
        } else {
          takeawaysGenerationError = error?.message || "Failed to generate takeaways. Please try again.";
        }
      }

      // Synchronous batch state update - all at once
      setTopics(generatedTopics);
      if (generatedTakeaways) {
        setTakeawaysContent(generatedTakeaways);
        setShowTakeawaysTab(true);
        setIsGeneratingTakeaways(false);
      } else if (takeawaysGenerationError) {
        setTakeawaysError(takeawaysGenerationError);
        setShowTakeawaysTab(true);
        setIsGeneratingTakeaways(false);
      }

      // Rate limit is handled server-side now
      checkRateLimit();

      // Save complete analysis to database in background
      backgroundOperation(
        'save-complete-analysis',
        async () => {
          const response = await fetch("/api/save-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoId: extractedVideoId,
              videoInfo: fetchedVideoInfo || {
                title: `YouTube Video ${extractedVideoId}`,
                author: 'Unknown',
                duration: 0,
                thumbnail: ''
              },
              transcript: fetchedTranscript,
              topics: generatedTopics,
              summary: generatedTakeaways,
              model: 'gemini-2.5-flash'
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(errorData.error || "Failed to save analysis");
          }
        },
        (error) => {
          console.error('Failed to save analysis to database:', error);
          toast.error('Unable to save video analysis. Your results are still visible.');
        }
      );

      // Generate suggested questions
      backgroundOperation(
        'generate-questions',
        async () => {
          const res = await fetch("/api/suggested-questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: fetchedTranscript,
              topics: generatedTopics,
              videoTitle: fetchedVideoInfo?.title
            }),
          });

          if (res.ok) {
            const { questions } = await res.json();
            setCachedSuggestedQuestions(questions);

            // Update video analysis with suggested questions
            await backgroundOperation(
              'update-questions',
              async () => {
                const updateRes = await fetch("/api/update-video-analysis", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    videoId: extractedVideoId,
                    suggestedQuestions: questions
                  }),
                });

                if (!updateRes.ok && updateRes.status !== 404) {
                  throw new Error('Failed to update suggested questions');
                }
              }
            );
            return questions;
          }
          return null;
        },
        (error) => {
          console.error("Failed to generate suggested questions:", error);
        }
      );
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setPageState('IDLE');
      setLoadingStage(null);
      setGenerationStartTime(null);
      setProcessingStartTime(null);
    }
  };

  const handleCitationClick = (citation: Citation) => {
    // Reset Play All mode when clicking a citation
    setIsPlayingAll(false);
    setPlayAllIndex(0);
    
    setSelectedTopic(null);
    setCitationHighlight(citation);

    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Request seek through centralized command system
    requestSeek(citation.start);
  };

  const handleTimestampClick = (seconds: number, _endSeconds?: number, isCitation: boolean = false, _citationText?: string, isWithinHighlightReel: boolean = false, isWithinCitationHighlight: boolean = false) => {
    // Reset Play All mode when clicking any timestamp
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    // Handle topic selection clearing:
    // Clear topic if it's a new citation click from AI chat OR
    // if clicking outside the current highlight reel (and not within a citation)
    if (isCitation || (!isWithinHighlightReel && !isWithinCitationHighlight)) {
      setSelectedTopic(null);
    }

    // Clear citation highlight for non-citation clicks
    if (!isCitation) {
      setCitationHighlight(null);
    }

    // Scroll to video player
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Request seek through centralized command system
    requestSeek(seconds);
  };

  const handleTakeawayTimestampClick = (seconds: number) => {
    // Reset Play All mode when clicking any timestamp
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    // Clear topic and citation highlight
    setSelectedTopic(null);
    setCitationHighlight(null);

    // Request seek through centralized command system
    requestSeek(seconds);
  };

  const handleTimeUpdate = useCallback((seconds: number) => {
    setCurrentTime(seconds);
  }, []);

  // Centralized segment-end detection
  useEffect(() => {
    if (!playbackContext || !isPlayerReady) return;

    // Check if we just initiated a seek (within last 1 second)
    const timeSinceLastSeek = Date.now() - lastSeekTimeRef.current;
    if (timeSinceLastSeek < 1000) {
      // Skip segment-end detection immediately after seeking
      return;
    }

    // Check if we've reached the end of current segment/topic
    if (currentTime >= playbackContext.endTime) {
      if (playbackContext.type === 'PLAY_ALL') {
        // Handle Play All mode transitions
        const nextIndex = (playbackContext.playAllIndex || 0) + 1;
        if (nextIndex < topics.length) {
          // Move to next topic
          const nextTopic = topics[nextIndex];
          lastSeekTimeRef.current = Date.now(); // Track the seek for next topic
          setPlaybackContext({
            ...playbackContext,
            playAllIndex: nextIndex,
            endTime: nextTopic.segments[0].end
          });
          setSelectedTopic(nextTopic);
          setPlaybackCommand({ type: 'SEEK', time: nextTopic.segments[0].start });
          setPlayAllIndex(nextIndex);
        } else {
          // End of all topics
          setPlaybackCommand({ type: 'PAUSE' });
          setPlaybackContext(null);
          setIsPlayingAll(false);
          setPlayAllIndex(0);
        }
      } else if (playbackContext.type === 'CITATIONS' && playbackContext.segments) {
        // Handle citation reel transitions
        const currentSegIdx = playbackContext.currentSegmentIndex || 0;
        if (currentSegIdx < playbackContext.segments.length - 1) {
          // Move to next citation segment
          const nextIdx = currentSegIdx + 1;
          const nextSegment = playbackContext.segments[nextIdx];
          lastSeekTimeRef.current = Date.now(); // Track the seek for next segment
          setPlaybackContext({
            ...playbackContext,
            currentSegmentIndex: nextIdx,
            endTime: nextSegment.end
          });
          setPlaybackCommand({ type: 'SEEK', time: nextSegment.start });
        } else {
          // End of citations
          setPlaybackCommand({ type: 'PAUSE' });
          setPlaybackContext(null);
        }
      } else {
        // Regular topic - just pause
        setPlaybackCommand({ type: 'PAUSE' });
        setPlaybackContext(null);
      }
    }
  }, [currentTime, playbackContext, isPlayerReady, topics, setSelectedTopic, setPlayAllIndex, setIsPlayingAll]);

  const handleTopicSelect = useCallback((topic: Topic | null, fromPlayAll: boolean = false) => {
    // Reset Play All mode only when manually selecting a topic (not from Play All)
    if (!fromPlayAll && isPlayingAll) {
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setPlaybackContext(null);
    }

    // Clear citation highlight when selecting a topic
    setCitationHighlight(null);
    setSelectedTopic(topic);

    // Request to play the topic through centralized command system
    if (topic && !fromPlayAll) {
      requestPlayTopic(topic);
    } else if (!topic) {
      // Clear playback context when deselecting
      setPlaybackContext(null);
    }
  }, [isPlayingAll, requestPlayTopic]);

  const handlePlayAllCitations = (citations: Citation[]) => {
    // Reset Play All mode when playing citations
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    // Clear existing highlights to avoid conflicts
    setCitationHighlight(null);

    // Scroll to video player
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Request to play citations through centralized command system
    requestPlayCitations(citations);
  };

  const handleTogglePlayAll = useCallback(() => {
    if (isPlayingAll) {
      // Stop playing all
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setPlaybackContext(null);
      setPlaybackCommand({ type: 'PAUSE' });
    } else {
      // Clear any existing selection to start fresh
      setSelectedTopic(null);
      setPlaybackContext(null);
      // Request to play all topics through centralized command system
      requestPlayAll();
    }
  }, [isPlayingAll, requestPlayAll]);

  // Dynamically adjust right column height to match video container
  useEffect(() => {
    const adjustRightColumnHeight = () => {
      const videoContainer = document.getElementById("video-container");
      const rightColumnContainer = document.getElementById("right-column-container");
      
      if (videoContainer && rightColumnContainer) {
        const videoHeight = videoContainer.offsetHeight;
        setTranscriptHeight(`${videoHeight}px`);
      }
    };

    // Initial adjustment
    adjustRightColumnHeight();

    // Adjust on window resize
    window.addEventListener("resize", adjustRightColumnHeight);
    
    // Also observe video container for size changes
    const resizeObserver = new ResizeObserver(adjustRightColumnHeight);
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      resizeObserver.observe(videoContainer);
    }

    return () => {
      window.removeEventListener("resize", adjustRightColumnHeight);
      resizeObserver.disconnect();
    };
  }, [videoId, topics]); // Re-run when video or topics change

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-[734px] flex-col items-center gap-10 px-6 pb-16 pt-[150px] text-center">
        <header className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-3">
            <Image 
              src="/Video_Play.svg" 
              alt="Video play icon" 
              width={34} 
              height={34}
              className="h-[34px] w-[34px]"
            />
            <h1 className="text-[24px] font-bold tracking-tight text-[#787878]">TLDW</h1>
          </div>
          <p className="text-[16px] leading-[17px] text-[#787878]">
            Too Long; Didn't Watch - Learn from long videos 10x faster
          </p>
        </header>

        <div className="flex w-full flex-col items-center gap-10">
          <UrlInput onSubmit={processVideo} isLoading={pageState === 'ANALYZING_NEW'} />

          {pageState === 'IDLE' && !videoId && (
            <Card className="relative flex w-[470px] max-w-full flex-col gap-3 overflow-hidden rounded-[24px] border border-[#f0f1f1] bg-white p-6 text-left shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)]">
              <div className="relative z-10 flex flex-col gap-3">
                <h3 className="text-[16px] font-medium leading-[17px] text-[#5c5c5c]">
                  Jump to top insights immediately
                </h3>
                <p className="text-[16px] leading-[1.2] text-[#8d8d8d]">
                  Paste a link, and we’ll generate highlight reels for you. Consume a 1-hour video in 5 minutes.
                </p>
              </div>
              <div className="pointer-events-none absolute right-[-28px] top-[-40px] h-[190px] w-[190px]">
                <div className="absolute inset-0 overflow-hidden rounded-full border border-white/40 shadow-[0_18px_45px_rgba(37,29,53,0.2)]">
                  <Image
                    src="/gradient_person.jpg"
                    alt="Gradient silhouette illustration"
                    fill
                    sizes="190px"
                    className="object-cover"
                    priority
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-full border border-white/60" />
                  <div className="pointer-events-none absolute inset-4 rounded-full border border-white/40" />
                </div>
                <div className="absolute inset-0 rounded-full bg-white/50 blur-[42px] opacity-70" />
              </div>
            </Card>
          )}
        </div>

        {error && (
          <Card className="max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border-destructive/20">
            <p className="text-destructive">{error}</p>
          </Card>
        )}

        {pageState === 'LOADING_CACHED' && (
          <VideoSkeleton />
        )}

        {pageState === 'ANALYZING_NEW' && (
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="flex flex-col items-center justify-center mb-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-foreground font-medium">Analyzing video and generating highlight reels</p>
              <p className="text-sm text-muted-foreground mt-2">
                {loadingStage === 'fetching' && 'Fetching transcript...'}
                {loadingStage === 'understanding' && 'Fetching transcript...'}
                {loadingStage === 'generating' && `Creating highlight reels... (${elapsedTime} seconds)`}
                {loadingStage === 'processing' && `Processing and matching quotes... (${processingElapsedTime} seconds)`}
              </p>
            </div>
            
            {/* Enhanced Loading Experience */}
            <LoadingContext 
              videoInfo={videoInfo}
              preview={videoPreview}
            />
            
            <LoadingTips />
          </div>
        )}

        {videoId && topics.length > 0 && pageState === 'IDLE' && (
          <>
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-6 pb-16 lg:grid-cols-3">
              {/* Left Column - Video (2/3 width) */}
              <div className="lg:col-span-2">
                <div className="sticky top-4" id="video-container">
                  <YouTubePlayer
                    videoId={videoId}
                    selectedTopic={selectedTopic}
                    playbackCommand={playbackCommand}
                    onCommandExecuted={clearPlaybackCommand}
                    onPlayerReady={handlePlayerReady}
                    topics={topics}
                    onTopicSelect={handleTopicSelect}
                    onTimeUpdate={handleTimeUpdate}
                    transcript={transcript}
                    isPlayingAll={isPlayingAll}
                    playAllIndex={playAllIndex}
                    onTogglePlayAll={handleTogglePlayAll}
                    setPlayAllIndex={memoizedSetPlayAllIndex}
                    setIsPlayingAll={memoizedSetIsPlayingAll}
                  />
                </div>
              </div>

              {/* Right Column - Tabbed Interface (1/3 width) */}
              <div className="lg:col-span-1">
                <div 
                  className="sticky top-4" 
                  id="right-column-container"
                  style={{ height: transcriptHeight, maxHeight: transcriptHeight }}
                >
                  <RightColumnTabs
                    ref={rightColumnTabsRef}
                    transcript={transcript}
                    selectedTopic={selectedTopic}
                    onTimestampClick={handleTimestampClick}
                    onTakeawayTimestampClick={handleTakeawayTimestampClick}
                    currentTime={currentTime}
                    topics={topics}
                    citationHighlight={citationHighlight}
                    videoId={videoId}
                    videoTitle={videoInfo?.title}
                    onCitationClick={handleCitationClick}
                    onPlayAllCitations={handlePlayAllCitations}
                    takeawaysContent={takeawaysContent}
                    isGeneratingTakeaways={isGeneratingTakeaways}
                    takeawaysError={takeawaysError}
                    showTakeawaysTab={showTakeawaysTab}
                    cachedSuggestedQuestions={cachedSuggestedQuestions}
                  />
                </div>
              </div>
            </div>
          </>
        )}

      </div>
      <AuthModal
        open={authModalOpen}
        onOpenChange={(open) => {
          // Store video before modal opens
          if (open && videoId && !user) {
            storeCurrentVideoForAuth();
          }
          setAuthModalOpen(open);
        }}
        trigger="generation-limit"
        onSuccess={() => {
          // Refresh rate limit info after successful auth
          checkRateLimit();
          // Check for pending video linking will happen via useEffect
        }}
        currentVideoId={videoId}
      />
    </div>
  );
}
