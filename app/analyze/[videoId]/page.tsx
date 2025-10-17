"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { UrlInputWithBranding } from "@/components/url-input-with-branding";
import { RightColumnTabs, type RightColumnTabsHandle } from "@/components/right-column-tabs";
import { YouTubePlayer } from "@/components/youtube-player";
import { HighlightsPanel } from "@/components/highlights-panel";
import { ThemeSelector } from "@/components/theme-selector";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { VideoSkeleton } from "@/components/video-skeleton";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Topic, TranscriptSegment, VideoInfo, Citation, PlaybackCommand, Note, NoteSource, NoteMetadata, TopicCandidate } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/quote-matcher";
import { hydrateTopicsWithTranscript, normalizeTranscript } from "@/lib/topic-utils";
import { SelectionActionPayload, EXPLAIN_SELECTION_EVENT } from "@/components/selection-actions";
import { fetchNotes, saveNote } from "@/lib/notes-client";
import { EditingNote } from "@/components/notes-panel";
import { useModePreference } from "@/lib/hooks/use-mode-preference";

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

const GUEST_LIMIT_MESSAGE = "You've used today's free analysis. Sign in to keep going.";

function buildApiErrorMessage(errorData: unknown, fallback: string): string {
  if (!errorData || typeof errorData !== "object") {
    return fallback;
  }

  const record = errorData as Record<string, unknown>;
  const errorText =
    typeof record.error === "string" && record.error.trim().length > 0
      ? record.error.trim()
      : "";
  const detailsText =
    typeof record.details === "string" && record.details.trim().length > 0
      ? record.details.trim()
      : "";

  if (errorText && detailsText) {
    return `${errorText}: ${detailsText}`;
  }

  if (detailsText) {
    return detailsText;
  }

  if (errorText) {
    return errorText;
  }

  return fallback;
}

export default function AnalyzePage() {
  const params = useParams<{ videoId: string }>();
  const routeVideoId = Array.isArray(params?.videoId) ? params.videoId[0] : params?.videoId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('IDLE');
  const hasAttemptedLinking = useRef(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating' | 'processing' | null>(null);
  const { mode, setMode } = useModePreference();
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [baseTopics, setBaseTopics] = useState<Topic[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [themeTopicsMap, setThemeTopicsMap] = useState<Record<string, Topic[]>>({});
  const [themeCandidateMap, setThemeCandidateMap] = useState<Record<string, TopicCandidate[]>>({});
  const [usedTopicKeys, setUsedTopicKeys] = useState<Set<string>>(new Set());
  const [isLoadingThemeTopics, setIsLoadingThemeTopics] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Centralized playback control state
  const [playbackCommand, setPlaybackCommand] = useState<PlaybackCommand | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [citationHighlight, setCitationHighlight] = useState<Citation | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const rightColumnTabsRef = useRef<RightColumnTabsHandle>(null);
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
  const [authLimitReached, setAuthLimitReached] = useState(false);
  const hasRedirectedForLimit = useRef(false);

  // Memoize processVideo to prevent infinite loops
  const processVideoMemo = useCallback(
    (url: string, isCached: boolean = false) => {
      processVideo(url, isCached);
    },
    []
  );

  const handleUrlSubmit = useCallback((url: string) => {
    const extractedId = extractVideoId(url);
    if (!extractedId) {
      toast.error("Please enter a valid YouTube URL");
      return;
    }

    const params = new URLSearchParams();
    params.set('url', url);

    router.push(`/analyze/${extractedId}?${params.toString()}`);
  }, [router]);

  // Centralized playback request functions
  const requestSeek = useCallback((time: number) => {
    if (!isPlayerReady) return;
    setPlaybackCommand({ type: 'SEEK', time });
  }, [isPlayerReady]);

  const requestPlayTopic = useCallback((topic: Topic) => {
    if (!isPlayerReady) return;
    setPlaybackCommand({ type: 'PLAY_TOPIC', topic, autoPlay: true });
  }, [isPlayerReady]);

  const requestPlaySegment = useCallback((segment: TranscriptSegment) => {
    if (!isPlayerReady) return;
    setPlaybackCommand({ type: 'PLAY_SEGMENT', segment });
  }, [isPlayerReady]);

  const requestPlayCitations = useCallback((citations: Citation[]) => {
    if (!isPlayerReady) return;
    setPlaybackCommand({ type: 'PLAY_CITATIONS', citations, autoPlay: true });
  }, [isPlayerReady]);

  const requestPlayAll = useCallback(() => {
    if (!isPlayerReady || topics.length === 0) return;
    // Set Play All state first
    setIsPlayingAll(true);
    setPlayAllIndex(0);
    setPlaybackCommand({ type: 'PLAY_ALL', autoPlay: true });
  }, [isPlayerReady, topics]);

  const clearPlaybackCommand = useCallback(() => {
    setPlaybackCommand(null);
  }, []);

  const handlePlayerReady = useCallback(() => {
    setIsPlayerReady(true);
  }, []);

  // Store current video data in sessionStorage before auth
  const storeCurrentVideoForAuth = useCallback((id?: string) => {
    const targetVideoId = id ?? videoId;
    if (targetVideoId && !user) {
      try {
        sessionStorage.setItem('pendingVideoId', targetVideoId);
        console.log('Stored video for post-auth linking:', targetVideoId);
      } catch (error) {
        console.error('Failed to persist pending video ID:', error);
      }
    }
  }, [user, videoId]);

  const redirectToAuthForLimit = useCallback(
    (message?: string, pendingVideoId?: string) => {
      if (hasRedirectedForLimit.current) {
        return;
      }

      hasRedirectedForLimit.current = true;

      const trimmedMessage = typeof message === "string" && message.trim().length > 0
        ? message.trim()
        : GUEST_LIMIT_MESSAGE;

      const targetVideoId = pendingVideoId ?? videoId ?? routeVideoId ?? null;
      if (targetVideoId) {
        storeCurrentVideoForAuth(targetVideoId);
      }

      if (trimmedMessage) {
        try {
          sessionStorage.setItem('limitRedirectMessage', trimmedMessage);
        } catch (error) {
          console.error('Failed to persist limit redirect message:', error);
        }
      }

      router.push('/?auth=limit');
    },
    [routeVideoId, router, storeCurrentVideoForAuth, videoId]
  );

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
        setAuthLimitReached(Boolean(data.isAuthenticated && !data.canGenerate));
      }
    } catch (error) {
      console.error('Error checking rate limit:', error);
      setAuthLimitReached(false);
    }
  };

  const urlParam = searchParams?.get('url');
  const cachedParam = searchParams?.get('cached');
  const authErrorParam = searchParams?.get('auth_error');
  const lastInitializedKey = useRef<string | null>(null);
  const normalizedUrl = urlParam ?? (routeVideoId ? `https://www.youtube.com/watch?v=${routeVideoId}` : "");

  // Clear auth errors from URL after notifying the user
  useEffect(() => {
    if (!authErrorParam || !routeVideoId) return;

    toast.error(`Authentication failed: ${decodeURIComponent(authErrorParam)}`);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('auth_error');

    const queryString = params.toString();
    router.replace(
      `/analyze/${routeVideoId}${queryString ? `?${queryString}` : ''}`,
      { scroll: false }
    );
  }, [authErrorParam, router, routeVideoId, searchParams]);

  // Automatically kick off analysis when arriving via dedicated route
  useEffect(() => {
    if (!routeVideoId) return;

    const key = `${routeVideoId}|${urlParam ?? ''}|${cachedParam ?? ''}`;
    if (lastInitializedKey.current === key) return;

    lastInitializedKey.current = key;

    // Store video ID for potential post-auth linking before loading
    if (!user) {
      sessionStorage.setItem('pendingVideoId', routeVideoId);
      console.log('Stored route video ID for potential post-auth linking:', routeVideoId);
    }

    const isCached = cachedParam === 'true';
    processVideoMemo(normalizedUrl, isCached);
  }, [routeVideoId, urlParam, cachedParam, user, processVideoMemo, normalizedUrl]);

  // Check if user can generate based on server-side rate limits
  const checkGenerationLimit = (pendingVideoId?: string): boolean => {
    if (user) {
      if (authLimitReached) {
        toast.error('Daily limit reached. Try again tomorrow!');
        return false;
      }
      return true;
    }

    if (rateLimitInfo.remaining === 0) {
      redirectToAuthForLimit(undefined, pendingVideoId);
      return false;
    }
    return true;
  };

  const processVideo = async (url: string, isCached: boolean = false) => {
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }

      if (!checkGenerationLimit(extractedVideoId)) {
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
      setBaseTopics([]);
      setTranscript([]);
      setThemes([]);
      setSelectedTheme(null);
      setThemeTopicsMap({});
      setThemeCandidateMap({});
      setUsedTopicKeys(new Set());
      setThemeError(null);
      setIsLoadingThemeTopics(false);
      setSelectedTopic(null);
      setCurrentTime(0);
      setVideoDuration(0);
      setCitationHighlight(null);
      setVideoInfo(null);
      setVideoPreview("");

      // Reset takeaways-related states
      setTakeawaysContent(null);
      setTakeawaysError("");
      setShowTakeawaysTab(false);

      // Reset cached suggested questions
      setCachedSuggestedQuestions(null);

      // Store video ID immediately for potential post-auth linking
      storeCurrentVideoForAuth(extractedVideoId);

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

          const sanitizedTranscript = normalizeTranscript(cacheData.transcript);
          const hydratedTopics = hydrateTopicsWithTranscript(
            Array.isArray(cacheData.topics) ? cacheData.topics : [],
            sanitizedTranscript,
          );

          // Load all cached data
          setTranscript(sanitizedTranscript);
          setVideoInfo(cacheData.videoInfo);
          setTopics(hydratedTopics);
          setBaseTopics(hydratedTopics);
          const initialKeys = new Set<string>();
          hydratedTopics.forEach(topic => {
            if (topic.quote?.timestamp && topic.quote.text) {
              const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
              initialKeys.add(key);
            }
          });
          setUsedTopicKeys(initialKeys);
          setSelectedTopic(hydratedTopics.length > 0 ? hydratedTopics[0] : null);

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
          storeCurrentVideoForAuth(extractedVideoId);

          // Set page state back to idle
          setPageState('IDLE');
          setLoadingStage(null);
          setProcessingStartTime(null);

          backgroundOperation(
            'load-cached-themes',
            async () => {
              const response = await fetch("/api/video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  videoInfo: cacheData.videoInfo,
                  transcript: sanitizedTranscript,
                  model: 'gemini-2.5-flash',
                  includeCandidatePool: true,
                  mode
                }),
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
                const message = buildApiErrorMessage(errorData, "Failed to generate themes");
                throw new Error(message);
              }

              const data = await response.json();
              if (Array.isArray(data.themes)) {
                setThemes(data.themes);
              }
              if (Array.isArray(data.topicCandidates)) {
                setThemeCandidateMap(prev => ({
                  ...prev,
                  __default: data.topicCandidates
                }));
              }
              return data.themes;
            },
            (error) => {
              console.error("Failed to generate themes for cached video:", error);
            }
          );

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
                    transcript: sanitizedTranscript,
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
                  const message = buildApiErrorMessage(errorData, "Failed to generate takeaways");
                  throw new Error(message);
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
        const message = buildApiErrorMessage(errorData, "Failed to fetch transcript");
        throw new Error(message);
      }

      const { transcript: fetchedTranscript } = await transcriptRes.json();
      const normalizedTranscriptData = normalizeTranscript(fetchedTranscript);
      setTranscript(normalizedTranscriptData);

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
          transcript: normalizedTranscriptData,
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
      const topicsController = abortManager.current.createController('topics');
      const takeawaysController = abortManager.current.createController('takeaways', 60000);

      // Start topics generation using cached video-analysis endpoint
      const topicsPromise = fetch("/api/video-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: extractedVideoId,
          videoInfo: fetchedVideoInfo,
          transcript: normalizedTranscriptData,
          model: 'gemini-2.5-flash',
          mode
        }),
        signal: topicsController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          throw new Error("Topic generation was canceled or interrupted. Please try again.");
        }
        throw new Error("Network error: Unable to generate topics. Please check your connection.");
      });

      // Start takeaways generation in parallel (will be ignored if cached)
      const takeawaysPromise = fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: normalizedTranscriptData,
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
      let generatedTopics: Topic[] = [];
      let generatedThemes: string[] = [];
      let generatedCandidates: TopicCandidate[] = [];
      if (topicsResult.status === 'fulfilled') {
      const topicsRes = topicsResult.value;

        if (!topicsRes.ok) {
          const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
          const requiresAuth = Boolean((errorData as any)?.requiresAuth);

          if (topicsRes.status === 429 && requiresAuth) {
            redirectToAuthForLimit(
              typeof (errorData as any)?.message === "string" ? (errorData as any).message : undefined,
              extractedVideoId
            );
            return;
          }

          const message = buildApiErrorMessage(errorData, "Failed to generate topics");
          throw new Error(message);
        }

        const topicsData = await topicsRes.json();
        const rawTopics = Array.isArray(topicsData.topics) ? topicsData.topics : [];
        generatedTopics = hydrateTopicsWithTranscript(rawTopics, normalizedTranscriptData);
        generatedThemes = Array.isArray(topicsData.themes) ? topicsData.themes : [];
        generatedCandidates = Array.isArray(topicsData.topicCandidates) ? topicsData.topicCandidates : [];
        generatedCandidates = generatedCandidates.map(candidate => ({
          ...candidate,
          key: `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`
        }));
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
          takeawaysGenerationError = buildApiErrorMessage(errorData, "Failed to generate takeaways. Please try again.");
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
      setBaseTopics(generatedTopics);
      const initialKeys = new Set<string>();
      generatedTopics.forEach(topic => {
        if (topic.quote?.timestamp && topic.quote.text) {
          initialKeys.add(`${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`);
        }
      });
      setUsedTopicKeys(initialKeys);
      setThemeCandidateMap(prev => ({
        ...prev,
        __default: generatedCandidates
      }));
      setSelectedTopic(generatedTopics.length > 0 ? generatedTopics[0] : null);
      setThemes(generatedThemes);
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
              transcript: normalizedTranscriptData,
              topics: generatedTopics,
              summary: generatedTakeaways,
              model: 'gemini-2.5-flash'
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            const message = buildApiErrorMessage(errorData, "Failed to save analysis");
            throw new Error(message);
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
              transcript: normalizedTranscriptData,
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

  const handleRetryTakeaways = useCallback(async () => {
    if (!videoId || !transcript.length) return;

    // Clear existing content and error
    setTakeawaysContent(null);
    setTakeawaysError("");
    setIsGeneratingTakeaways(true);

    try {
      const takeawaysController = abortManager.current.createController('retry-takeaways', 60000);

      const response = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          videoInfo,
          videoId
        }),
        signal: takeawaysController.signal,
      });

      if (response.ok) {
        const { summaryContent: generatedTakeaways } = await response.json();
        setTakeawaysContent(generatedTakeaways);

        // Update the video analysis with the new takeaways
        backgroundOperation(
          'update-retry-takeaways',
          async () => {
            await fetch("/api/update-video-analysis", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                videoId,
                summary: generatedTakeaways
              }),
            });
          }
        );
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        const message = buildApiErrorMessage(errorData, "Failed to generate takeaways");
        throw new Error(message);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to generate takeaways. Please try again.";
      setTakeawaysError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsGeneratingTakeaways(false);
      abortManager.current.cleanup('retry-takeaways');
    }
  }, [videoId, transcript, videoInfo]);

  const handleTimeUpdate = useCallback((seconds: number) => {
    setCurrentTime(seconds);
  }, []);

  const handleTopicSelect = useCallback((topic: Topic | null, fromPlayAll: boolean = false) => {
    // Reset Play All mode only when manually selecting a topic (not from Play All)
    if (!fromPlayAll && isPlayingAll) {
      setIsPlayingAll(false);
      setPlayAllIndex(0);
    }

    // Clear citation highlight when selecting a topic
    setCitationHighlight(null);
    setSelectedTopic(topic);

    // Request to play the topic through centralized command system
    if (topic && !fromPlayAll) {
      requestPlayTopic(topic);
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
      setPlaybackCommand({ type: 'PAUSE' });
    } else {
      // Clear any existing selection to start fresh
      setSelectedTopic(null);
      // Request to play all topics through centralized command system
      requestPlayAll();
    }
  }, [isPlayingAll, requestPlayAll]);

  const handleThemeSelect = useCallback(async (themeLabel: string | null) => {
    if (!videoId) return;

    const resetToDefault = () => {
      setSelectedTheme(null);
      setThemeError(null);
      setTopics(baseTopics);
      setSelectedTopic(null);
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setUsedTopicKeys(new Set(
        baseTopics
          .filter((topic): topic is Topic & { quote: { timestamp: string; text: string } } => !!topic.quote?.timestamp && !!topic.quote.text)
          .map(topic => `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`)
      ));
    };

    if (!themeLabel) {
      resetToDefault();
      return;
    }

    const normalizedTheme = themeLabel.trim();

    if (!normalizedTheme) {
      resetToDefault();
      return;
    }

    if (selectedTheme === normalizedTheme) {
      resetToDefault();
      return;
    }

    setSelectedTheme(normalizedTheme);
    setThemeError(null);
    setIsLoadingThemeTopics(true);
    setSelectedTopic(null);
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    let themedTopics = themeTopicsMap[normalizedTheme];
    const needsHydration =
      Array.isArray(themedTopics) &&
      themedTopics.some((topic) => {
        const firstSegment = Array.isArray(topic?.segments) ? topic.segments[0] : null;
        return !firstSegment || typeof firstSegment.start !== 'number' || typeof firstSegment.end !== 'number';
      });

    if (themedTopics && needsHydration) {
      themedTopics = hydrateTopicsWithTranscript(themedTopics, transcript);
      setThemeTopicsMap(prev => ({
        ...prev,
        [normalizedTheme]: themedTopics || [],
      }));
    }

    if (!themedTopics) {
      const controller = abortManager.current.createController('theme-topics');
      const exclusionKeys = Array.from(usedTopicKeys).map((key) => key.slice(0, 500));
      try {
        const response = await fetch("/api/video-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId,
            videoInfo,
            transcript,
            model: 'gemini-2.5-flash',
            theme: normalizedTheme,
            excludeTopicKeys: exclusionKeys,
            mode
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          const message = buildApiErrorMessage(errorData, "Failed to generate themed topics");
          throw new Error(message);
        }

        const data = await response.json();
        const hydratedThemeTopics = hydrateTopicsWithTranscript(Array.isArray(data.topics) ? data.topics : [], transcript);
        const candidatePool = Array.isArray(data.topicCandidates) ? data.topicCandidates : undefined;
        setThemeCandidateMap(prev => ({
          ...prev,
          [normalizedTheme]: candidatePool ?? []
        }));
        const nextUsedKeys = new Set(usedTopicKeys);
        hydratedThemeTopics.forEach(topic => {
          if (topic.quote?.timestamp && topic.quote.text) {
            nextUsedKeys.add(`${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`);
          }
        });
        setUsedTopicKeys(nextUsedKeys);
        themedTopics = hydratedThemeTopics;
        setThemeTopicsMap(prev => ({
          ...prev,
          [normalizedTheme]: themedTopics || []
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate themed topics";
        console.error("Theme-specific generation failed:", error);
        setThemeError(message);
        resetToDefault();
        abortManager.current.cleanup('theme-topics');
        setIsLoadingThemeTopics(false);
        return;
      } finally {
        abortManager.current.cleanup('theme-topics');
      }
    }

    if (!themedTopics) {
      themedTopics = [];
    }

    setTopics(themedTopics);
    if (themedTopics.length === 0) {
      setThemeCandidateMap(prev => ({
        ...prev,
        [normalizedTheme]: prev[normalizedTheme] ?? []
      }));
    }

    if (themedTopics.length > 0) {
      setSelectedTopic(themedTopics[0]);
      setThemeError(null);
    } else {
      setThemeError("No highlights available for this theme yet.");
      setSelectedTopic(null);
    }

    setIsLoadingThemeTopics(false);
  }, [
    videoId,
    videoInfo,
    transcript,
    selectedTheme,
    baseTopics,
    themeTopicsMap,
    themeCandidateMap,
    usedTopicKeys,
    abortManager,
    setIsPlayingAll,
    setPlayAllIndex
  ]);

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

  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);

  useEffect(() => {
    if (!videoId || !user) {
      setNotes([]);
      return;
    }

    setIsLoadingNotes(true);
    fetchNotes({ youtubeId: videoId })
      .then(setNotes)
      .catch((error) => {
        console.error("Failed to load notes", error);
      })
      .finally(() => setIsLoadingNotes(false));
  }, [videoId, user]);

  // Auto-switch to Takeaways tab when Explain is triggered from transcript
  useEffect(() => {
    const handleExplainFromSelection = () => {
      // Switch to takeaways tab when explain is triggered
      rightColumnTabsRef.current?.switchToTakeaways?.();
    };

    window.addEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    return () => {
      window.removeEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    };
  }, []);

  const handleSaveNote = useCallback(async ({ text, source, sourceId, metadata }: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => {
    if (!videoId) return;

    try {
      const note = await saveNote({
        youtubeId: videoId,
        source,
        sourceId: sourceId ?? undefined,
        text,
        metadata: metadata ?? undefined,
      });
      setNotes((prev) => [note, ...prev]);
      toast.success("Note saved");
    } catch (error) {
      console.error("Failed to save note", error);
      toast.error("Failed to save note");
    }
  }, [videoId]);

  const handleTakeNoteFromSelection = useCallback((payload: SelectionActionPayload) => {
    // Switch to notes tab
    rightColumnTabsRef.current?.switchToNotes();

    // Set editing state with selected text, metadata, and source
    setEditingNote({
      text: payload.text,
      metadata: payload.metadata ?? null,
      source: payload.source,
    });
  }, []);

  const handleSaveEditingNote = useCallback(async (noteText: string) => {
    if (!editingNote || !videoId) return;

    // Use source from editing note or determine from metadata
    let source: NoteSource = "custom";
    if (editingNote.source) {
      source = editingNote.source as NoteSource;
    } else if (editingNote.metadata?.chat) {
      source = "chat";
    } else if (editingNote.metadata?.transcript) {
      source = "transcript";
    }

    await handleSaveNote({
      text: noteText,
      source,
      sourceId: editingNote.metadata?.chat?.messageId ?? null,
      metadata: editingNote.metadata,
    });

    // Clear editing state
    setEditingNote(null);
  }, [editingNote, videoId, handleSaveNote]);

  const handleCancelEditing = useCallback(() => {
    setEditingNote(null);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center px-5 py-5">
          <UrlInputWithBranding
            onSubmit={handleUrlSubmit}
            isLoading={pageState !== 'IDLE'}
            initialUrl={normalizedUrl}
            mode={mode}
            onModeChange={setMode}
          />
        </div>
        {error && (
          <div className="border-t border-red-100 bg-red-50/80">
            <div className="mx-auto w-full max-w-7xl px-5 py-2.5 text-xs text-red-600">
              {error}
            </div>
          </div>
        )}
      </header>

      {pageState === 'IDLE' && !videoId && (
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-5 px-5 py-18 text-center">
          <Card className="w-full border border-dashed border-slate-200 bg-white/70 p-9 backdrop-blur-sm">
            <div className="space-y-2.5">
              <h2 className="text-xl font-semibold text-slate-900">Drop a video to start analyzing</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Paste a YouTube link above to generate highlight reels, searchable transcripts, and AI takeaways.
              </p>
            </div>
          </Card>
        </div>
      )}

      {pageState === 'LOADING_CACHED' && (
        <div className="mx-auto w-full max-w-7xl px-5 py-11">
          <VideoSkeleton />
        </div>
      )}

      {pageState === 'ANALYZING_NEW' && (
        <div className="mx-auto w-full max-w-7xl px-5 py-11">
          <div className="mb-7 flex flex-col items-center justify-center text-center">
            <Loader2 className="mb-3.5 h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-slate-700">Analyzing video and generating highlight reels</p>
            <p className="mt-1.5 text-xs text-slate-500">
              {loadingStage === 'fetching' && 'Fetching transcript...'}
              {loadingStage === 'understanding' && 'Fetching transcript...'}
              {loadingStage === 'generating' && `Creating highlight reels... (${elapsedTime} seconds)`}
              {loadingStage === 'processing' && `Processing and matching quotes... (${processingElapsedTime} seconds)`}
            </p>
          </div>

          <LoadingContext
            videoInfo={videoInfo}
            preview={videoPreview}
          />

          <LoadingTips />
        </div>
      )}

      {videoId && topics.length > 0 && pageState === 'IDLE' && (
        <div className="mx-auto w-full max-w-7xl px-5 pb-14 pt-9">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Left Column - Video (2/3 width) */}
            <div className="lg:col-span-2">
              <div className="sticky top-3.5 space-y-3.5" id="video-container">
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
                  renderControls={false}
                  onDurationChange={setVideoDuration}
                />
                {(themes.length > 0 || isLoadingThemeTopics || themeError || selectedTheme) && (
                  <div className="flex justify-center">
                    <ThemeSelector
                      themes={themes}
                      selectedTheme={selectedTheme}
                      onSelect={handleThemeSelect}
                      isLoading={isLoadingThemeTopics}
                      error={themeError}
                    />
                  </div>
                )}
                <HighlightsPanel
                  topics={topics}
                  selectedTopic={selectedTopic}
                  onTopicSelect={(topic) => handleTopicSelect(topic)}
                  onPlayTopic={requestPlayTopic}
                  onSeek={requestSeek}
                  onPlayAll={handleTogglePlayAll}
                  isPlayingAll={isPlayingAll}
                  playAllIndex={playAllIndex}
                  currentTime={currentTime}
                  videoDuration={videoDuration}
                  transcript={transcript}
                  isLoadingThemeTopics={isLoadingThemeTopics}
                  videoId={videoId ?? undefined}
                />
              </div>
            </div>

            {/* Right Column - Tabbed Interface (1/3 width) */}
            <div className="lg:col-span-1">
              <div
                className="sticky top-3.5"
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
                  onRetryTakeaways={handleRetryTakeaways}
                  notes={notes}
                  onSaveNote={handleSaveNote}
                  onTakeNoteFromSelection={handleTakeNoteFromSelection}
                  editingNote={editingNote}
                  onSaveEditingNote={handleSaveEditingNote}
                  onCancelEditing={handleCancelEditing}
                />
              </div>
            </div>
          </div>
        </div>
      )}

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
