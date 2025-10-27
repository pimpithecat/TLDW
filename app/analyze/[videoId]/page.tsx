"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { RightColumnTabs, type RightColumnTabsHandle } from "@/components/right-column-tabs";
import { YouTubePlayer } from "@/components/youtube-player";
import { HighlightsPanel } from "@/components/highlights-panel";
import { ThemeSelector } from "@/components/theme-selector";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { VideoSkeleton } from "@/components/video-skeleton";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Topic, TranscriptSegment, VideoInfo, Citation, PlaybackCommand, Note, NoteSource, NoteMetadata, TopicCandidate, TopicGenerationMode } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/quote-matcher";
import { hydrateTopicsWithTranscript, normalizeTranscript } from "@/lib/topic-utils";
import { SelectionActionPayload, EXPLAIN_SELECTION_EVENT } from "@/components/selection-actions";
import { fetchNotes, saveNote } from "@/lib/notes-client";
import { EditingNote } from "@/components/notes-panel";
import { useModePreference } from "@/lib/hooks/use-mode-preference";

// Page state for better UX
type PageState = 'IDLE' | 'ANALYZING_NEW' | 'LOADING_CACHED';
type AuthModalTrigger = 'generation-limit' | 'save-video' | 'manual' | 'save-note';
import { extractVideoId } from "@/lib/utils";
import { useElapsedTimer } from "@/lib/hooks/use-elapsed-timer";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AuthModal } from "@/components/auth-modal";
import { useAuth } from "@/contexts/auth-context";
import { backgroundOperation, AbortManager } from "@/lib/promise-utils";
import { toast } from "sonner";
import { buildSuggestedQuestionFallbacks } from "@/lib/suggested-question-fallback";

const GUEST_LIMIT_MESSAGE = "You've used today's free analysis. Sign in to keep going.";
const AUTH_LIMIT_MESSAGE = "You get 5 videos per day. Come back tomorrow.";
const DEFAULT_CLIENT_ERROR = "Something went wrong. Please try again.";

function normalizeErrorMessage(message: string | undefined, fallback: string = DEFAULT_CLIENT_ERROR): string {
  const trimmed = typeof message === "string" ? message.trim() : "";
  const baseMessage = trimmed.length > 0 ? trimmed : fallback;
  const normalizedSource = `${trimmed} ${baseMessage}`.toLowerCase();

  if (
    normalizedSource.includes("user aborted request") ||
    normalizedSource.includes("unsupported transcript language")
  ) {
    return "Only YouTube videos with English transcripts are supported right now. Please choose a video that has English captions enabled.";
  }

  return baseMessage;
}

function buildApiErrorMessage(errorData: unknown, fallback: string): string {
  if (!errorData || typeof errorData !== "object") {
    return normalizeErrorMessage(undefined, fallback);
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
    return normalizeErrorMessage(`${errorText}: ${detailsText}`, fallback);
  }

  if (detailsText) {
    return normalizeErrorMessage(detailsText, fallback);
  }

  if (errorText) {
    return normalizeErrorMessage(errorText, fallback);
  }

  return normalizeErrorMessage(undefined, fallback);
}

export default function AnalyzePage() {
  const params = useParams<{ videoId: string }>();
  const routeVideoId = Array.isArray(params?.videoId) ? params.videoId[0] : params?.videoId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlParam = searchParams?.get('url');
  const cachedParam = searchParams?.get('cached');
  const cachedParamValue = cachedParam?.toLowerCase();
  const isCachedQuery = cachedParamValue === 'true' || cachedParamValue === '1';
  const authErrorParam = searchParams?.get('auth_error');
  const [pageState, setPageState] = useState<PageState>(() =>
    (routeVideoId || urlParam)
      ? (isCachedQuery ? 'LOADING_CACHED' : 'ANALYZING_NEW')
      : 'IDLE'
  );
  const hasAttemptedLinking = useRef(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating' | 'processing' | null>(null);
  const { mode, isLoading: isModeLoading } = useModePreference();
  const [error, setError] = useState("");
  const [isRateLimitError, setIsRateLimitError] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [translatedTranscripts, setTranslatedTranscripts] = useState<Record<string, TranscriptSegment[]>>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const [baseTopics, setBaseTopics] = useState<Topic[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [themeTopicsMap, setThemeTopicsMap] = useState<Record<string, Topic[]>>({});
  const [themeCandidateMap, setThemeCandidateMap] = useState<Record<string, TopicCandidate[]>>({});
  const [usedTopicKeys, setUsedTopicKeys] = useState<Set<string>>(new Set());
  const [isLoadingThemeTopics, setIsLoadingThemeTopics] = useState(false);
  const [isSuggestingThemes, setIsSuggestingThemes] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Centralized playback control state
  const [playbackCommand, setPlaybackCommand] = useState<PlaybackCommand | null>(null);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [citationHighlight, setCitationHighlight] = useState<Citation | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const rightColumnTabsRef = useRef<RightColumnTabsHandle>(null);
  const abortManager = useRef(new AbortManager());
  const selectedThemeRef = useRef<string | null>(null);
  const nextThemeRequestIdRef = useRef(0);
  const activeThemeRequestIdRef = useRef<number | null>(null);
  const pendingThemeRequestsRef = useRef(new Map<string, number>());

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
  const [, setTakeawaysContent] = useState<string | null>(null);
  const [, setIsGeneratingTakeaways] = useState<boolean>(false);
  const [, setTakeawaysError] = useState<string>("");
  const [showChatTab, setShowChatTab] = useState<boolean>(false);

  // Cached suggested questions
  const [cachedSuggestedQuestions, setCachedSuggestedQuestions] = useState<string[] | null>(null);

  // Use custom hook for timer logic
  const elapsedTime = useElapsedTimer(generationStartTime);
  const processingElapsedTime = useElapsedTimer(processingStartTime);

  // Auth and generation limit state
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTrigger, setAuthModalTrigger] = useState<AuthModalTrigger>('generation-limit');
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    remaining: number | null;
    resetAt: Date | null;
  }>({ remaining: -1, resetAt: null });
  const [authLimitReached, setAuthLimitReached] = useState(false);
  const hasRedirectedForLimit = useRef(false);

  // Centralized playback request functions
  const requestSeek = useCallback((time: number) => {
    setPlaybackCommand({ type: 'SEEK', time });
  }, []);

  const requestPlayTopic = useCallback((topic: Topic) => {
    setPlaybackCommand({ type: 'PLAY_TOPIC', topic, autoPlay: true });
  }, []);

  const requestPlayAll = useCallback(() => {
    if (topics.length === 0) return;
    // Set Play All state first
    setIsPlayingAll(true);
    setPlayAllIndex(0);
    setPlaybackCommand({ type: 'PLAY_ALL', autoPlay: true });
  }, [topics]);

  const clearPlaybackCommand = useCallback(() => {
    setPlaybackCommand(null);
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

  const promptSignInForNotes = useCallback(() => {
    if (user) return;
    storeCurrentVideoForAuth();
    setAuthModalTrigger('save-note');
    setAuthModalOpen(true);
  }, [storeCurrentVideoForAuth, user, setAuthModalTrigger]);

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

  const checkRateLimit = useCallback(async () => {
    try {
      const response = await fetch('/api/check-limit');
      const data = await response.json();

      setAuthLimitReached(Boolean(data?.isAuthenticated && data?.canGenerate === false));

      if (Object.prototype.hasOwnProperty.call(data ?? {}, 'remaining')) {
        const remainingValue =
          typeof data.remaining === 'number'
            ? data.remaining
            : data.remaining === null
              ? null
              : -1;

        setRateLimitInfo({
          remaining: remainingValue,
          resetAt: data.resetAt ? new Date(data.resetAt) : null
        });
      }

      return data;
    } catch (error) {
      console.error('Error checking rate limit:', error);
      setAuthLimitReached(false);
      return null;
    }
  }, []);

  // Check rate limit status on mount
  useEffect(() => {
    checkRateLimit();
  }, [checkRateLimit]);

  // Handle pending video linking when user logs in and videoId is available
  useEffect(() => {
    const pendingVideoId = sessionStorage.getItem('pendingVideoId');
    const videoToLink = pendingVideoId || videoId;
    
    // Only attempt linking if:
    // 1. User is authenticated
    // 2. Haven't attempted linking for this specific video yet
    // 3. There's a video to link
    if (user && videoToLink && !hasAttemptedLinking.current) {
      hasAttemptedLinking.current = true;
      // Delay the link attempt to ensure authentication is fully propagated
      setTimeout(() => {
        checkPendingVideoLink();
      }, 1500);
    }
  }, [user, videoId]); // Track both user and videoId

  // Cleanup AbortManager on component unmount
  useEffect(() => {
    const currentAbortManager = abortManager.current;
    return () => {
      // Abort all pending requests when component unmounts
      currentAbortManager.cleanup();
    };
  }, []);

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
  // Check if user can generate based on server-side rate limits
  const checkGenerationLimit = useCallback((
    pendingVideoId?: string,
    remainingOverride?: number | null
  ): boolean => {
    if (user) {
      if (authLimitReached) {
        setIsRateLimitError(true);
        setError(AUTH_LIMIT_MESSAGE);
        toast.error(AUTH_LIMIT_MESSAGE);
        return false;
      }
      return true;
    }

    const effectiveRemaining =
      typeof remainingOverride === 'number' || remainingOverride === null
        ? remainingOverride
        : rateLimitInfo.remaining;

    if (
      typeof effectiveRemaining === 'number' &&
      effectiveRemaining !== -1 &&
      effectiveRemaining <= 0
    ) {
      redirectToAuthForLimit(undefined, pendingVideoId);
      return false;
    }
    return true;
  }, [user, authLimitReached, rateLimitInfo.remaining, redirectToAuthForLimit]);

  const processVideo = useCallback(async (
    url: string,
    selectedMode: TopicGenerationMode
  ) => {
    const currentRemaining = rateLimitInfo.remaining;
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }

      // Cleanup any pending requests from previous analysis
      abortManager.current.cleanup();
      pendingThemeRequestsRef.current.clear();
      activeThemeRequestIdRef.current = null;
      nextThemeRequestIdRef.current = 0;
      selectedThemeRef.current = null;

      setError("");
      setIsRateLimitError(false);
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
      setPlaybackCommand(null);
      setIsPlayingAll(false);
      setPlayAllIndex(0);

      // Reset takeaways-related states
      setTakeawaysContent(null);
      setTakeawaysError("");
      setShowChatTab(false);

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
          setPageState('LOADING_CACHED');

          const sanitizedTranscript = normalizeTranscript(cacheData.transcript);
          const hydratedTopics = hydrateTopicsWithTranscript(
            Array.isArray(cacheData.topics) ? cacheData.topics : [],
            sanitizedTranscript,
          );

          // Load all cached data
          setTranscript(sanitizedTranscript);
          
          console.log('[AnalyzePage] Cached translations from API:', cacheData.translatedTranscripts);
          if (cacheData.translatedTranscripts) {
            setTranslatedTranscripts(cacheData.translatedTranscripts);
          }

          const cachedVideoInfo = cacheData.videoInfo ?? null;
          if (cachedVideoInfo) {
            setVideoInfo(cachedVideoInfo);
            const rawDuration = (cachedVideoInfo as { duration?: number | string | null }).duration;
            const numericDuration =
              typeof rawDuration === "number"
                ? rawDuration
                : typeof rawDuration === "string"
                  ? Number(rawDuration)
                  : null;
            if (numericDuration && !Number.isNaN(numericDuration) && numericDuration > 0) {
              setVideoDuration(numericDuration);
            }
          } else {
            setVideoInfo(null);
          }

          // Separate base topics, real theme topics, and placeholders
          const baseTopicsFromCache = hydratedTopics.filter(topic => !topic.theme);
          const themeTopicsFromCache = hydratedTopics.filter(topic => 
            topic.theme && !topic.id?.startsWith('placeholder-')
          );
          
          // Reconstruct themeTopicsMap (excluding placeholders)
          const reconstructedThemeMap: Record<string, Topic[]> = {};
          themeTopicsFromCache.forEach(topic => {
            if (topic.theme) {
              if (!reconstructedThemeMap[topic.theme]) {
                reconstructedThemeMap[topic.theme] = [];
              }
              reconstructedThemeMap[topic.theme].push(topic);
            }
          });
          
          setTopics(baseTopicsFromCache);
          setBaseTopics(baseTopicsFromCache);
          setThemeTopicsMap(reconstructedThemeMap);
          
          const initialKeys = new Set<string>();
          hydratedTopics.forEach(topic => {
            if (topic.quote?.timestamp && topic.quote.text) {
              const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
              initialKeys.add(key);
            }
          });
          setUsedTopicKeys(initialKeys);
          setSelectedTopic(baseTopicsFromCache.length > 0 ? baseTopicsFromCache[0] : null);

          // Set cached takeaways and questions
          if (cacheData.summary) {
            setTakeawaysContent(cacheData.summary);
            setShowChatTab(true);
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

          // Extract themes from topics (those with theme field, including placeholders)
          const themesFromCache = [...new Set(
            hydratedTopics
              .filter(topic => topic.theme && topic.theme.trim().length > 0)
              .map(topic => topic.theme as string)
          )];
          setThemes(themesFromCache);

          // Auto-start takeaways generation if not available
          if (!cacheData.summary) {
            setShowChatTab(true);
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

      let effectiveRemaining = currentRemaining;

      if (!user) {
        const latestLimitData = await checkRateLimit();
        if (latestLimitData && Object.prototype.hasOwnProperty.call(latestLimitData, 'remaining')) {
          effectiveRemaining =
            typeof latestLimitData.remaining === 'number'
              ? latestLimitData.remaining
              : latestLimitData.remaining === null
                ? null
                : effectiveRemaining;
        }
      }

      if (!checkGenerationLimit(extractedVideoId, effectiveRemaining)) {
        return;
      }

      setPageState('ANALYZING_NEW');
      setLoadingStage('fetching');

      // Not cached, proceed with normal flow
      // Create AbortControllers for both requests
      const transcriptController = abortManager.current.createController('transcript', 300000);
      const videoInfoController = abortManager.current.createController('videoInfo', 100000);

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

      let fetchedTranscript;
      try {
        const data = await transcriptRes.json();
        fetchedTranscript = data.transcript;
      } catch (jsonError) {
        if (jsonError instanceof Error && jsonError.name === 'AbortError') {
          throw new Error("Transcript processing timed out. The video may be too long. Please try again.");
        }
        throw new Error("Failed to process transcript data. Please try again.");
      }

      const normalizedTranscriptData = normalizeTranscript(fetchedTranscript);
      setTranscript(normalizedTranscriptData);

      // Process video info response (optional)
      let fetchedVideoInfo: VideoInfo | null = null;
      if (videoInfoRes && videoInfoRes.ok) {
        try {
          const videoInfoData = await videoInfoRes.json();
          if (videoInfoData && !videoInfoData.error) {
            setVideoInfo(videoInfoData);
            const rawDuration = videoInfoData?.duration;
            const numericDuration =
              typeof rawDuration === "number"
                ? rawDuration
                : typeof rawDuration === "string"
                  ? Number(rawDuration)
                  : null;
            if (numericDuration && !Number.isNaN(numericDuration) && numericDuration > 0) {
              setVideoDuration(numericDuration);
            }
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
      // Extended timeout for AI generation (Gemini can take 60+ seconds)
      const topicsController = abortManager.current.createController('topics', 120000); // 2 minutes
      const takeawaysController = abortManager.current.createController('takeaways', 120000); // 2 minutes

      // Start topics generation using cached video-analysis endpoint
      const topicsPromise = fetch("/api/video-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: extractedVideoId,
          videoInfo: fetchedVideoInfo,
          transcript: normalizedTranscriptData,
          model: 'gemini-2.5-flash',
          mode: selectedMode,
          includeCandidatePool: selectedMode === 'smart' // Generate placeholders for smart mode
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
      setShowChatTab(true);
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
      let allTopicsWithPlaceholders: any[] = []; // Track all topics including placeholders
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

          if (topicsRes.status === 429) {
            setIsRateLimitError(true);
            checkRateLimit();

            const limitMessageRaw =
              typeof (errorData as any)?.message === "string"
                ? (errorData as any).message.trim()
                : "";

            const limitErrorRaw =
              typeof (errorData as any)?.error === "string"
                ? (errorData as any).error.trim()
                : "";

            const limitMessage =
              limitMessageRaw.length > 0
                ? limitMessageRaw
                : limitErrorRaw.length > 0
                  ? limitErrorRaw
                  : AUTH_LIMIT_MESSAGE;

            throw new Error(limitMessage);
          }

          const message = buildApiErrorMessage(errorData, "Failed to generate topics");
          throw new Error(message);
        }

        const topicsData = await topicsRes.json();
        const rawTopics = Array.isArray(topicsData.topics) ? topicsData.topics : [];
        allTopicsWithPlaceholders = rawTopics; // Store all including placeholders
        
        // Separate real topics from placeholders
        const realTopics = rawTopics.filter((t: any) => !t.id?.startsWith('placeholder-'));
        
        // Only hydrate real topics (placeholders don't need hydration)
        generatedTopics = hydrateTopicsWithTranscript(realTopics, normalizedTranscriptData);
        
        // Extract unique themes from ALL topics (including placeholders)
        const themesArray: string[] = rawTopics
          .filter((topic: any) => topic.theme && typeof topic.theme === 'string' && topic.theme.trim().length > 0)
          .map((topic: any) => topic.theme as string);
        generatedThemes = [...new Set(themesArray)];
        
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
        setShowChatTab(true);
        setIsGeneratingTakeaways(false);
      } else if (takeawaysGenerationError) {
        setTakeawaysError(takeawaysGenerationError);
        setShowChatTab(true);
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
              topics: allTopicsWithPlaceholders.length > 0 ? allTopicsWithPlaceholders : generatedTopics,
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

          const applyCachedQuestions = (questions: string[]) => {
            if (questions.length === 0) {
              return questions;
            }
            setCachedSuggestedQuestions(prev => {
              if (prev && prev.length > 0) {
                return prev;
              }
              return questions;
            });
            return questions;
          };

          if (!res.ok) {
            console.error("Failed to generate suggested questions:", res.status, res.statusText);
            return applyCachedQuestions(buildSuggestedQuestionFallbacks(3));
          }

          let parsed: unknown;
          try {
            parsed = await res.json();
          } catch (error) {
            console.error("Failed to parse suggested questions payload:", error);
            return applyCachedQuestions(buildSuggestedQuestionFallbacks(3));
          }

          const questions = Array.isArray((parsed as any)?.questions)
            ? (parsed as any).questions
                .filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item: string) => item.trim())
            : [];

          const normalizedQuestions = questions.length > 0
            ? questions.slice(0, 3)
            : buildSuggestedQuestionFallbacks(3);

          applyCachedQuestions(normalizedQuestions);

          // Update video analysis with suggested questions
          await backgroundOperation(
            'update-questions',
            async () => {
              const updateRes = await fetch("/api/update-video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  suggestedQuestions: normalizedQuestions
                }),
              });

              if (!updateRes.ok && updateRes.status !== 404) {
                throw new Error('Failed to update suggested questions');
              }
            }
          );

          return normalizedQuestions;
        },
        (error) => {
          console.error("Failed to generate suggested questions:", error);
        }
      );
      
    } catch (err) {
      setError(
        normalizeErrorMessage(
          err instanceof Error ? err.message : undefined,
          "An error occurred"
        )
      );
    } finally {
      setPageState('IDLE');
      setLoadingStage(null);
      setGenerationStartTime(null);
      setProcessingStartTime(null);
    }
  }, [
    rateLimitInfo.remaining,
    storeCurrentVideoForAuth,
    videoId,
    checkRateLimit,
    user,
    checkGenerationLimit,
    redirectToAuthForLimit
  ]);

  useEffect(() => {
    if (!routeVideoId || isModeLoading) return;

    const key = `${routeVideoId}|${urlParam ?? ''}|${cachedParam ?? ''}|${mode}`;
    if (lastInitializedKey.current === key) return;

    lastInitializedKey.current = key;

    // Store video ID for potential post-auth linking before loading
    if (!user) {
      sessionStorage.setItem('pendingVideoId', routeVideoId);
      console.log('Stored route video ID for potential post-auth linking:', routeVideoId);
    }

    processVideo(normalizedUrl, mode);
  }, [routeVideoId, urlParam, cachedParam, user, normalizedUrl, isModeLoading, mode, processVideo]);

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

  useEffect(() => {
    selectedThemeRef.current = selectedTheme;
  }, [selectedTheme]);

  const handleThemeSelect = useCallback(async (themeLabel: string | null) => {
    if (!videoId) return;

    const resetToDefault = (options?: { preserveError?: boolean }) => {
      if (!options?.preserveError) {
        setThemeError(null);
      }
      setSelectedTheme(null);
      selectedThemeRef.current = null;
      setTopics(baseTopics);
      setSelectedTopic(null);
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setIsLoadingThemeTopics(false);
      activeThemeRequestIdRef.current = null;
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

    setSelectedTheme(normalizedTheme);
    selectedThemeRef.current = normalizedTheme;
    setThemeError(null);
    setSelectedTopic(null);
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    const pendingRequestId = pendingThemeRequestsRef.current.get(normalizedTheme);

    if (!themedTopics && typeof pendingRequestId === "number") {
      activeThemeRequestIdRef.current = pendingRequestId;
      setIsLoadingThemeTopics(true);
      return;
    }

    if (!themedTopics) {
      const requestId = ++nextThemeRequestIdRef.current;
      pendingThemeRequestsRef.current.set(normalizedTheme, requestId);
      activeThemeRequestIdRef.current = requestId;
      setIsLoadingThemeTopics(true);
      const requestKey = `theme-topics:${normalizedTheme}:${requestId}`;
      const controller = abortManager.current.createController(requestKey);
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
        
        // Tag theme topics with theme name
        const themedTopicsWithTheme = hydratedThemeTopics.map(topic => ({
          ...topic,
          theme: normalizedTheme
        }));
        
        themedTopics = themedTopicsWithTheme;
        setThemeTopicsMap(prev => ({
          ...prev,
          [normalizedTheme]: themedTopics || []
        }));

        // Save theme topics to database (background operation)
        // Replace placeholder with real topics
        backgroundOperation(
          'save-theme-topics',
          async () => {
            // Get current topics from database first
            const checkResponse = await fetch("/api/check-video-cache", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` })
            });
            
            let existingTopics: any[] = [];
            if (checkResponse.ok) {
              const cacheData = await checkResponse.json();
              existingTopics = cacheData.topics || [];
            }
            
            // Remove placeholder for this theme
            const topicsWithoutPlaceholder = existingTopics.filter(t => 
              !(t.id?.startsWith('placeholder-') && t.theme === normalizedTheme)
            );
            
            // Remove old topics for this theme (if any)
            const topicsWithoutOldTheme = topicsWithoutPlaceholder.filter(t => t.theme !== normalizedTheme);
            
            // Add new theme topics
            const allTopics = [
              ...topicsWithoutOldTheme,
              ...themedTopicsWithTheme
            ];

            await fetch("/api/update-video-analysis", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                videoId,
                topics: allTopics
              })
            });
          }
        );
      } catch (error) {
        const isAbortError =
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name?: string }).name === "AbortError";

        if (isAbortError) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to generate themed topics";
        console.error("Theme-specific generation failed:", error);
        if (selectedThemeRef.current === normalizedTheme) {
          resetToDefault({ preserveError: true });
          setThemeError(message);
        }
        return;
      } finally {
        abortManager.current.cleanup(requestKey);
        pendingThemeRequestsRef.current.delete(normalizedTheme);
        if (
          activeThemeRequestIdRef.current === requestId &&
          selectedThemeRef.current === normalizedTheme
        ) {
          setIsLoadingThemeTopics(false);
          activeThemeRequestIdRef.current = null;
        }
      }
    } else {
      activeThemeRequestIdRef.current = null;
      setIsLoadingThemeTopics(false);
    }

    if (!themedTopics) {
      themedTopics = [];
    }

    if (themedTopics.length === 0) {
      setThemeCandidateMap(prev => ({
        ...prev,
        [normalizedTheme]: prev[normalizedTheme] ?? []
      }));
    }

    if (selectedThemeRef.current !== normalizedTheme) {
      return;
    }

    setTopics(themedTopics);
    if (themedTopics.length > 0) {
      setSelectedTopic(themedTopics[0]);
      setThemeError(null);
    } else {
      setThemeError("No highlights available for this theme yet.");
      setSelectedTopic(null);
    }
  }, [
    videoId,
    videoInfo,
    transcript,
    selectedTheme,
    baseTopics,
    themeTopicsMap,
    usedTopicKeys,
    mode,
    setIsPlayingAll,
    setPlayAllIndex
  ]);

  const handleSuggestThemes = useCallback(async () => {
    if (!videoId || isSuggestingThemes) return;

    // Check if already at max themes (10)
    if (themes.length >= 10) {
      toast.error('Maximum topics reached. Please delete some topics first.');
      return;
    }

    setIsSuggestingThemes(true);
    try {
      const response = await fetch('/api/suggest-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId })
      });

      if (!response.ok) {
        throw new Error('Failed to generate theme suggestions');
      }

      const data = await response.json();
      if (data.suggestedThemes && data.suggestedThemes.length > 0) {
        // Refresh themes from updated topics
        const cacheResponse = await fetch('/api/check-video-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` })
        });

        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          const updatedTopics = cacheData.topics || [];
          const themesArray: string[] = updatedTopics
            .filter((t: any) => t.theme && typeof t.theme === 'string' && t.theme.trim().length > 0)
            .map((t: any) => t.theme as string);
          setThemes([...new Set(themesArray)]);
          toast.success(`Added ${data.suggestedThemes.length} new topic${data.suggestedThemes.length > 1 ? 's' : ''}`);
        }
      } else {
        toast.info('No new topics found. All suggested topics already exist.');
      }
    } catch (error) {
      console.error('Error suggesting themes:', error);
      toast.error('Failed to generate topic suggestions');
    } finally {
      setIsSuggestingThemes(false);
    }
  }, [videoId, isSuggestingThemes, themes.length]);

  const handleDeleteTheme = useCallback(async (theme: string) => {
    if (!videoId) return;

    try {
      // Get current topics from database
      const checkResponse = await fetch('/api/check-video-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` })
      });

      if (!checkResponse.ok) {
        throw new Error('Failed to load video data');
      }

      const cacheData = await checkResponse.json();
      const existingTopics = cacheData.topics || [];

      // Remove all topics with this theme (including placeholders and real topics)
      const filteredTopics = existingTopics.filter((t: any) => t.theme !== theme);

      // Update database
      const updateResponse = await fetch('/api/update-video-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          topics: filteredTopics
        })
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to delete theme');
      }

      // Update local state
      setThemes(prev => prev.filter(t => t !== theme));
      setThemeTopicsMap(prev => {
        const newMap = { ...prev };
        delete newMap[theme];
        return newMap;
      });

      // If deleted theme was selected, reset to base topics
      if (selectedTheme === theme) {
        setSelectedTheme(null);
        setTopics(baseTopics);
        setSelectedTopic(baseTopics[0] || null);
      }

      toast.success(`Deleted theme: ${theme}`);
    } catch (error) {
      console.error('Error deleting theme:', error);
      toast.error('Failed to delete theme');
    }
  }, [videoId, selectedTheme, baseTopics]);

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

  // Auto-switch to Chat tab when Explain is triggered from transcript
  useEffect(() => {
    const handleExplainFromSelection = () => {
      // Switch to chat tab when explain is triggered
      rightColumnTabsRef.current?.switchToChat?.();
    };

    window.addEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    return () => {
      window.removeEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    };
  }, []);

  const handleSaveNote = useCallback(async ({ text, source, sourceId, metadata }: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => {
    if (!videoId) return;
    if (!user) {
      promptSignInForNotes();
      return;
    }

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
  }, [videoId, user, promptSignInForNotes]);

  const handleTakeNoteFromSelection = useCallback((payload: SelectionActionPayload) => {
    if (!user) {
      promptSignInForNotes();
      return;
    }

    // Switch to notes tab
    rightColumnTabsRef.current?.switchToNotes();

    // Set editing state with selected text, metadata, and source
    setEditingNote({
      text: payload.text,
      metadata: payload.metadata ?? null,
      source: payload.source,
    });
  }, [promptSignInForNotes, user]);

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

  // Compute placeholder themes (themes that don't have generated topics in themeTopicsMap)
  const placeholderThemes = useMemo(() => {
    const placeholders = new Set<string>();
    
    // Check each theme in the themes array
    themes.forEach(themeName => {
      const topicsForTheme = themeTopicsMap[themeName];
      
      if (!topicsForTheme || topicsForTheme.length === 0) {
        // Theme exists but has no topics generated yet
        placeholders.add(themeName);
      } else {
        const hasGeneratedTopics = topicsForTheme.some(t => Array.isArray(t.segments) && t.segments.length > 0);
        if (!hasGeneratedTopics) {
          placeholders.add(themeName);
        }
      }
    });
    
    return placeholders;
  }, [themes, themeTopicsMap]);

  // Sort themes: generated first, placeholders last
  const sortedThemes = useMemo(() => {
    return [...themes].sort((a, b) => {
      const aIsPlaceholder = placeholderThemes.has(a);
      const bIsPlaceholder = placeholderThemes.has(b);
      
      // If one is placeholder and other is not, non-placeholder comes first
      if (aIsPlaceholder && !bIsPlaceholder) return 1;
      if (!aIsPlaceholder && bIsPlaceholder) return -1;
      
      // Otherwise maintain original order
      return 0;
    });
  }, [themes, placeholderThemes]);

  return (
    <div className="min-h-screen bg-white pt-12 pb-2">
      {pageState === 'IDLE' && !videoId && !routeVideoId && !urlParam && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5 text-center">
          {error && (
            <div className="mb-6 w-full max-w-2xl">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
                {error}
              </div>
            </div>
          )}
          <Card className="w-full max-w-2xl border border-dashed border-slate-200 bg-white/80 p-9 backdrop-blur-sm">
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-900">Ready to analyze a video?</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Head back to the home page to paste a YouTube link and generate highlight reels, searchable transcripts, and AI takeaways.
              </p>
              <div className="pt-1">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#f8fafc]"
                >
                  Go to home
                </Link>
              </div>
            </div>
          </Card>
        </section>
      )}

      {pageState === 'LOADING_CACHED' && (
        <section className="flex min-h-[calc(100vh-11rem)] items-center justify-center px-5">
          <div className="w-full max-w-7xl">
            <VideoSkeleton />
          </div>
        </section>
      )}

      {pageState === 'ANALYZING_NEW' && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5">
          {error && (
            <div className="mb-6 w-full max-w-2xl">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
                {error}
              </div>
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <Loader2 className="mb-3.5 h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-slate-700">Analyzing video and generating highlight reels</p>
            <p className="mt-1.5 text-xs text-slate-500">
              {loadingStage === 'fetching' && 'Fetching transcript...'}
              {loadingStage === 'understanding' && 'Fetching transcript...'}
              {loadingStage === 'generating' && `Creating highlight reels... (${elapsedTime} seconds)`}
              {loadingStage === 'processing' && `Processing and matching quotes... (${processingElapsedTime} seconds)`}
            </p>
          </div>
          <div className="mt-10 w-full max-w-2xl">
            <LoadingContext
              videoInfo={videoInfo}
              preview={videoPreview}
            />
          </div>
          <div className="w-full max-w-2xl">
            <LoadingTips />
          </div>
        </section>
      )}

      {pageState === 'IDLE' && videoId && topics.length === 0 && error && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5 text-center">
          <Card className="w-full max-w-2xl border border-slate-200 bg-white/90 p-9 backdrop-blur-sm">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {isRateLimitError ? 'Daily limit reached' : 'We couldn\'t finish analyzing this video'}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {isRateLimitError
                    ? AUTH_LIMIT_MESSAGE
                    : error}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#f8fafc]"
                >
                  Go to home
                </Link>
                {!isRateLimitError && (
                  <button
                    type="button"
                    onClick={() => processVideo(normalizedUrl, mode)}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
                    disabled={isModeLoading}
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </Card>
        </section>
      )}

      {videoId && topics.length > 0 && pageState === 'IDLE' && (
        <div className="mx-auto w-full max-w-7xl px-5 pb-5 pt-0">
          {error && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Left Column - Video (2/3 width) */}
            <div className="lg:col-span-2">
              <div className="sticky top-[6.5rem] space-y-3.5" id="video-container">
                <YouTubePlayer
                  videoId={videoId}
                  selectedTopic={selectedTopic}
                  playbackCommand={playbackCommand}
                  onCommandExecuted={clearPlaybackCommand}
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
                <div className="flex justify-center">
                  <ThemeSelector
                    themes={sortedThemes}
                    selectedTheme={selectedTheme}
                    onSelect={handleThemeSelect}
                    onDelete={handleDeleteTheme}
                    onSuggestThemes={handleSuggestThemes}
                    isLoading={isLoadingThemeTopics}
                    isSuggesting={isSuggestingThemes}
                    error={themeError}
                    placeholderThemes={placeholderThemes}
                  />
                </div>
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
                className="sticky top-[6.5rem]"
                id="right-column-container"
                style={{ height: transcriptHeight, maxHeight: transcriptHeight }}
              >
                <RightColumnTabs
                  ref={rightColumnTabsRef}
                  transcript={transcript}
                  selectedTopic={selectedTopic}
                  onTimestampClick={handleTimestampClick}
                  currentTime={currentTime}
                  topics={topics}
                  citationHighlight={citationHighlight}
                  videoId={videoId}
                  videoTitle={videoInfo?.title}
                  videoInfo={videoInfo}
                  onCitationClick={handleCitationClick}
                  showChatTab={showChatTab}
                  cachedSuggestedQuestions={cachedSuggestedQuestions}
                  notes={notes}
                  onSaveNote={handleSaveNote}
                  onTakeNoteFromSelection={handleTakeNoteFromSelection}
                  editingNote={editingNote}
                  onSaveEditingNote={handleSaveEditingNote}
                  onCancelEditing={handleCancelEditing}
                  isAuthenticated={!!user}
                  onRequestSignIn={promptSignInForNotes}
                  youtubeId={videoId}
                  cachedTranslations={translatedTranscripts}
                  onTranslationUpdate={setTranslatedTranscripts}
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
          if (!open) {
            setAuthModalTrigger('generation-limit');
          }
          setAuthModalOpen(open);
        }}
        trigger={authModalTrigger}
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
