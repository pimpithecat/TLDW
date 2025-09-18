"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { UrlInput } from "@/components/url-input";
import { RightColumnTabs, type RightColumnTabsHandle } from "@/components/right-column-tabs";
import { YouTubePlayer } from "@/components/youtube-player";
import { LanguageSelector, type Language } from "@/components/language-selector";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { Topic, TranscriptSegment, VideoInfo, Citation } from "@/lib/types";
import { extractVideoId } from "@/lib/utils";
import { useElapsedTimer } from "@/lib/hooks/use-elapsed-timer";
import { Loader2, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AuthModal } from "@/components/auth-modal";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating' | 'processing'>('fetching');
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [seekToTime, setSeekToTime] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [summaryLanguage, setSummaryLanguage] = useState<Language>('English');
  const [citationHighlight, setCitationHighlight] = useState<Citation | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const rightColumnTabsRef = useRef<RightColumnTabsHandle>(null);
  
  // Play All state (lifted from YouTubePlayer)
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);
  
  // Summary generation state
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string>("");
  const [showSummaryTab, setShowSummaryTab] = useState<boolean>(false);

  // Cached suggested questions
  const [cachedSuggestedQuestions, setCachedSuggestedQuestions] = useState<string[] | null>(null);

  // Use custom hook for timer logic
  const elapsedTime = useElapsedTimer(generationStartTime);
  const processingElapsedTime = useElapsedTimer(processingStartTime);

  // Auth and generation limit state
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);

  // Memoize processVideo to prevent infinite loops
  const processVideoMemo = useCallback((url: string) => {
    processVideo(url);
  }, []);

  // Load generation count from localStorage on mount
  useEffect(() => {
    if (!user) {
      const count = parseInt(localStorage.getItem('generationCount') || '0');
      setGenerationCount(count);
    }
  }, [user]);

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

    if (videoIdParam && cachedParam === 'true' && !isLoading && !videoId) {
      // Load cached video directly
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoIdParam}`;
      processVideoMemo(youtubeUrl);
    }
  }, []); // Empty dependency array - only run once on mount

  // Check if user can generate
  const checkGenerationLimit = (): boolean => {
    if (user) return true; // Authenticated users have no limits

    const count = parseInt(localStorage.getItem('generationCount') || '0');
    if (count >= 1) {
      // Show auth modal for second generation
      setAuthModalOpen(true);
      return false;
    }
    return true;
  };

  const processVideo = async (url: string) => {
    // Check generation limit for anonymous users
    if (!checkGenerationLimit()) {
      return;
    }
    setIsLoading(true);
    setLoadingStage('fetching');
    setError("");
    setVideoInfo(null);
    setVideoPreview("");

    // Reset summary-related states
    setSummaryContent(null);
    setSummaryError("");
    setShowSummaryTab(false);

    // Reset cached suggested questions
    setCachedSuggestedQuestions(null);
    
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }
      
      setVideoId(extractedVideoId);

      // Create AbortControllers for both requests
      const transcriptController = new AbortController();
      const videoInfoController = new AbortController();
      const transcriptTimeoutId = setTimeout(() => transcriptController.abort(), 30000); // 30 second timeout
      const videoInfoTimeoutId = setTimeout(() => videoInfoController.abort(), 10000); // 10 second timeout

      // Fetch transcript and video info in parallel
      const transcriptPromise = fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: transcriptController.signal,
      }).catch(err => {
        clearTimeout(transcriptTimeoutId);
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
        clearTimeout(videoInfoTimeoutId);
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

      clearTimeout(transcriptTimeoutId);
      clearTimeout(videoInfoTimeoutId);

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
        .then(res => res.json())
        .then(data => {
          if (data && data.preview) {
            setVideoPreview(data.preview);
          }
        })
        .catch(() => {});
      
      // Initiate parallel API requests for topics and summary
      setLoadingStage('generating');
      setGenerationStartTime(Date.now());
      
      // Create abort controller for topics request
      const topicsController = new AbortController();
      const topicsTimeoutId = setTimeout(() => topicsController.abort(), 600000); // 60 second timeout

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
        clearTimeout(topicsTimeoutId);
        if (err.name === 'AbortError') {
          throw new Error("Topic generation timed out. The video might be too long. Please try a shorter video.");
        }
        throw new Error("Network error: Unable to generate topics. Please check your connection.");
      });

      // Wait for topics to complete first (prioritize highlight reels)
      const topicsRes = await topicsPromise;
      clearTimeout(topicsTimeoutId);
      
      // Check topics response
      if (!topicsRes.ok) {
        const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to generate topics");
      }
      
      // Move to processing stage
      setLoadingStage('processing');
      setGenerationStartTime(null);
      setProcessingStartTime(Date.now());
      
      const topicsData = await topicsRes.json();
      const generatedTopics = topicsData.topics;
      setTopics(generatedTopics);

      // If data is cached, use the cached summary and suggested questions
      if (topicsData.cached) {
        // Use cached summary if available
        if (topicsData.summary) {
          setSummaryContent(topicsData.summary);
          setShowSummaryTab(true);
          setIsGeneratingSummary(false);
        }

        // Use cached suggested questions if available
        if (topicsData.suggestedQuestions) {
          setCachedSuggestedQuestions(topicsData.suggestedQuestions);
        }
      } else {
        // Update generation count for anonymous users
        if (!user) {
          const newCount = generationCount + 1;
          localStorage.setItem('generationCount', newCount.toString());
          setGenerationCount(newCount);
        }

        // Generate new summary
        setShowSummaryTab(true);
        setIsGeneratingSummary(true);

        const summaryController = new AbortController();
        const summaryTimeoutId = setTimeout(() => summaryController.abort(), 600000); // 60 second timeout

        const summaryPromise = fetch("/api/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: fetchedTranscript,
            videoInfo: fetchedVideoInfo,
            videoId: extractedVideoId,
            language: summaryLanguage
          }),
          signal: summaryController.signal,
        });

        // Handle summary generation in the background
        summaryPromise
          .then(async (summaryRes) => {
            clearTimeout(summaryTimeoutId);

            if (!summaryRes.ok) {
              const errorData = await summaryRes.json().catch(() => ({ error: "Unknown error" }));
              setSummaryError(errorData.error || "Failed to generate summary");
            } else {
              const { summaryContent: generatedSummary } = await summaryRes.json();
              setSummaryContent(generatedSummary);

              // Update the video analysis with the summary
              fetch("/api/update-video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  summary: generatedSummary
                }),
              }).catch(err => console.error("Failed to update video analysis with summary:", err));
            }
          })
          .catch((err) => {
            clearTimeout(summaryTimeoutId);
            if (err.name === 'AbortError') {
              setSummaryError("Summary generation timed out. The video might be too long.");
            } else {
              setSummaryError("Failed to generate summary. Please try again.");
            }
          })
          .finally(() => {
            setIsGeneratingSummary(false);
          });

        // Generate suggested questions
        fetch("/api/suggested-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: fetchedTranscript,
            topics: generatedTopics,
            videoTitle: fetchedVideoInfo?.title
          }),
        })
          .then(async (res) => {
            if (res.ok) {
              const { questions } = await res.json();
              setCachedSuggestedQuestions(questions);

              // Update video analysis with suggested questions
              fetch("/api/update-video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  suggestedQuestions: questions
                }),
              }).catch(err => console.error("Failed to update suggested questions:", err));
            }
          })
          .catch(err => console.error("Failed to generate suggested questions:", err));
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
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
    setSeekToTime(citation.start);
    setTimeout(() => setSeekToTime(undefined), 100);
  };

  const handleTimestampClick = (seconds: number, _endSeconds?: number, isCitation: boolean = false, _citationText?: string, isWithinHighlightReel: boolean = false, isWithinCitationHighlight: boolean = false) => {
    // Prevent rapid sequential clicks and state updates
    if (seekToTime === seconds) return;
    
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
    
    // Seek video to timestamp
    setSeekToTime(seconds);
    
    // Clear seek state after a short delay
    setTimeout(() => {
      setSeekToTime(undefined);
    }, 100);
  };

  const handleSummaryTimestampClick = (seconds: number) => {
    // Prevent rapid sequential clicks and state updates
    if (seekToTime === seconds) return;
    
    // Reset Play All mode when clicking any timestamp
    setIsPlayingAll(false);
    setPlayAllIndex(0);
    
    // Clear topic and citation highlight
    setSelectedTopic(null);
    setCitationHighlight(null);
    
    // Seek video to timestamp without scrolling
    setSeekToTime(seconds);
    
    // Clear seek state after a short delay
    setTimeout(() => {
      setSeekToTime(undefined);
    }, 100);
  };

  const handleTimeUpdate = (seconds: number) => {
    setCurrentTime(seconds);
  };

  const handleTopicSelect = (topic: Topic | null) => {
    // Reset Play All mode when manually selecting a topic
    // (unless it's being called by Play All itself)
    if (!isPlayingAll) {
      setIsPlayingAll(false);
      setPlayAllIndex(0);
    }
    
    // Clear citation highlight when selecting a topic
    setCitationHighlight(null);
    setSelectedTopic(topic);
    
    // Immediately play the topic when selected
    if (topic && topic.segments.length > 0) {
      setSeekToTime(topic.segments[0].start);
      setTimeout(() => setSeekToTime(undefined), 100);
    }
  };

  const handlePlayAllCitations = (citations: Citation[]) => {
    // Reset Play All mode when playing citations
    setIsPlayingAll(false);
    setPlayAllIndex(0);
    
    // Clear existing highlights to avoid conflicts
    setCitationHighlight(null);
    
    // Create a "citation reel" - a temporary Topic object from citations
    const citationReel: Topic = {
      id: `citation-reel-${Date.now()}`,
      title: "Cited Clips",
      description: "Playing all clips cited in the AI response",
      duration: citations.reduce((total, c) => total + (c.end - c.start), 0),
      segments: citations.map(c => ({
        start: c.start,
        end: c.end,
        text: c.text,
        startSegmentIdx: c.startSegmentIdx,
        endSegmentIdx: c.endSegmentIdx,
        startCharOffset: c.startCharOffset,
        endCharOffset: c.endCharOffset,
      })),
      isCitationReel: true, // Set the flag to identify this as a citation reel
      autoPlay: true, // Add flag to indicate this should auto-play
    };
    
    // Set the citation reel as the selected topic to trigger playback
    setSelectedTopic(citationReel);
    
    // Seek to the first citation to start playback
    if (citations.length > 0) {
      setSeekToTime(citations[0].start);
    }
    
    // Scroll to video player
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Start playing the first citation
    if (citations.length > 0) {
      setSeekToTime(citations[0].start);
      setTimeout(() => setSeekToTime(undefined), 100);
    }
  };

  const handleTogglePlayAll = () => {
    if (isPlayingAll) {
      // Stop playing all
      setIsPlayingAll(false);
    } else {
      // Start playing all from the beginning
      setIsPlayingAll(true);
      setPlayAllIndex(0);
      // Select the first topic to start playback
      if (topics.length > 0) {
        setSelectedTopic(topics[0]);
        setSeekToTime(topics[0].segments[0].start);
        setTimeout(() => setSeekToTime(undefined), 100);
      }
    }
  };

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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Video className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              TLDW
            </h1>
          </div>
          <p className="text-muted-foreground">Too Long; Didn't Watch - Smart Video Navigation</p>
        </header>

        <div className="flex flex-col items-center gap-4 mb-8">
          <UrlInput onSubmit={processVideo} isLoading={isLoading} />
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Language:</span>
              <LanguageSelector
                value={summaryLanguage}
                onChange={setSummaryLanguage}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {error && (
          <Card className="max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border-destructive/20">
            <p className="text-destructive">{error}</p>
          </Card>
        )}

        {isLoading && (
          <div className="max-w-6xl mx-auto">
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

        {videoId && topics.length > 0 && !isLoading && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Left Column - Video (2/3 width) */}
              <div className="lg:col-span-2">
                <div className="sticky top-4" id="video-container">
                  <YouTubePlayer
                    videoId={videoId}
                    selectedTopic={selectedTopic}
                    seekToTime={seekToTime}
                    topics={topics}
                    onTopicSelect={handleTopicSelect}
                    onTimeUpdate={handleTimeUpdate}
                    transcript={transcript}
                    isPlayingAll={isPlayingAll}
                    playAllIndex={playAllIndex}
                    onTogglePlayAll={handleTogglePlayAll}
                    setPlayAllIndex={setPlayAllIndex}
                    setIsPlayingAll={setIsPlayingAll}
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
                    onSummaryTimestampClick={handleSummaryTimestampClick}
                    currentTime={currentTime}
                    topics={topics}
                    citationHighlight={citationHighlight}
                    videoId={videoId}
                    videoTitle={videoInfo?.title}
                    onCitationClick={handleCitationClick}
                    onPlayAllCitations={handlePlayAllCitations}
                    summaryContent={summaryContent}
                    isGeneratingSummary={isGeneratingSummary}
                    summaryError={summaryError}
                    showSummaryTab={showSummaryTab}
                    cachedSuggestedQuestions={cachedSuggestedQuestions}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {!isLoading && !error && topics.length === 0 && !videoId && (
          <Card className="max-w-2xl mx-auto p-12 text-center bg-muted/30">
            <Video className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground mb-2 text-lg">
              Enter a YouTube URL above to get started
            </p>
            <p className="text-sm text-muted-foreground">
              We'll analyze the video and create smart topics for efficient navigation
            </p>
          </Card>
        )}
      </div>
      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        trigger="generation-limit"
        onSuccess={() => {
          // Reset generation count after successful auth
          localStorage.removeItem('generationCount');
          setGenerationCount(0);
        }}
      />
    </div>
  );
}