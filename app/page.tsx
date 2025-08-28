"use client";

import { useState, useRef } from "react";
import { UrlInput } from "@/components/url-input";
import { TopicCard } from "@/components/topic-card";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { YouTubePlayer } from "@/components/youtube-player";
import { AIChat } from "@/components/ai-chat";
import { Topic, TranscriptSegment } from "@/lib/types";
import { extractVideoId } from "@/lib/utils";
import { Loader2, Video, FileText, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [seekToTime, setSeekToTime] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);

  const processVideo = async (url: string) => {
    setIsLoading(true);
    setError("");
    
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }
      
      setVideoId(extractedVideoId);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      // Fetch transcript
      console.log("Fetching transcript for URL:", url);
      const transcriptRes = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      }).catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.error("Request timeout:", err);
          throw new Error("Request timed out. Please try again.");
        }
        console.error("Network error fetching transcript:", err);
        throw new Error("Network error: Unable to connect to server. Please ensure the server is running.");
      });
      
      clearTimeout(timeoutId);
      
      if (!transcriptRes.ok) {
        const errorData = await transcriptRes.json().catch(() => ({ error: "Unknown error" }));
        console.error("Transcript API error:", transcriptRes.status, errorData);
        throw new Error(errorData.error || "Failed to fetch transcript");
      }
      
      const { transcript: fetchedTranscript } = await transcriptRes.json();
      setTranscript(fetchedTranscript);
      
      // Generate topics with timeout
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 60000); // 60 second timeout for AI generation
      
      console.log("Generating topics for video:", extractedVideoId);
      const topicsRes = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          transcript: fetchedTranscript,
          videoId: extractedVideoId
        }),
        signal: controller2.signal,
      }).catch(err => {
        clearTimeout(timeoutId2);
        if (err.name === 'AbortError') {
          console.error("Request timeout:", err);
          throw new Error("Topic generation timed out. The video might be too long. Please try a shorter video.");
        }
        console.error("Network error generating topics:", err);
        throw new Error("Network error: Unable to generate topics. Please check your connection.");
      });
      
      clearTimeout(timeoutId2);
      
      if (!topicsRes.ok) {
        const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
        console.error("Topics API error:", topicsRes.status, errorData);
        throw new Error(errorData.error || "Failed to generate topics");
      }
      
      const { topics: generatedTopics } = await topicsRes.json();
      console.log("Generated topics count:", generatedTopics?.length || 0);
      console.log("Full topic objects:", JSON.stringify(generatedTopics, null, 2));
      
      // Log each topic's structure for debugging
      generatedTopics?.forEach((topic: any, index: number) => {
        console.log(`Topic ${index + 1}:`, {
          title: topic.title,
          segmentCount: topic.segments?.length || 0,
          keywordCount: topic.keywords?.length || 0,
          keywords: topic.keywords || [],
          duration: topic.duration
        });
      });
      
      setTopics(generatedTopics);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      console.error("Error processing video:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTimestampClick = (seconds: number) => {
    // Prevent rapid sequential clicks and state updates
    if (seekToTime === seconds) return;
    
    setSeekToTime(seconds);
    // Use setTimeout instead of nested requestAnimationFrame to avoid rapid state updates
    setTimeout(() => {
      setSeekToTime(undefined);
    }, 100);
  };

  const handleTimeUpdate = (seconds: number) => {
    setCurrentTime(seconds);
  };

  const handlePlayTopic = () => {
    if (selectedTopic && selectedTopic.segments.length > 0) {
      setSeekToTime(selectedTopic.segments[0].start);
    }
  };

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

        <div className="flex justify-center mb-8">
          <UrlInput onSubmit={processVideo} isLoading={isLoading} />
        </div>

        {error && (
          <Card className="max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border-destructive/20">
            <p className="text-destructive">{error}</p>
          </Card>
        )}

        {isLoading && (
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col items-center justify-center py-12 mb-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-foreground font-medium">Analyzing video and generating topics...</p>
              <p className="text-sm text-muted-foreground mt-2">This may take a minute</p>
            </div>
            
            {/* Loading skeletons */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <Skeleton className="h-[320px] w-full rounded-lg" />
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                </div>
              </div>
              <div className="lg:col-span-1">
                <Skeleton className="h-[calc(100vh-6rem)] w-full rounded-lg" />
              </div>
            </div>
          </div>
        )}

        {videoId && topics.length > 0 && !isLoading && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Left Column - Video (2/3 width) */}
              <div className="lg:col-span-2">
                <div className="sticky top-4 h-[calc(100vh-6rem)]">
                  <YouTubePlayer
                    videoId={videoId}
                    selectedTopic={selectedTopic}
                    seekToTime={seekToTime}
                    topics={topics}
                    onTopicSelect={setSelectedTopic}
                    onTimeUpdate={handleTimeUpdate}
                    transcript={transcript}
                  />
                </div>
              </div>

              {/* Right Column - Transcript (1/3 width) */}
              <div className="lg:col-span-1">
                <div className="sticky top-4 h-[calc(100vh-6rem)] overflow-hidden">
                  <TranscriptViewer
                    transcript={transcript}
                    selectedTopic={selectedTopic}
                    onTimestampClick={handleTimestampClick}
                    currentTime={currentTime}
                    topics={topics}
                  />
                </div>
              </div>
            </div>

            {/* AI Chat Section - Full width below */}
            <div className="max-w-4xl mx-auto">
              <AIChat
                transcript={transcript}
                topics={topics}
                videoId={videoId}
                onTimestampClick={handleTimestampClick}
              />
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
    </div>
  );
}