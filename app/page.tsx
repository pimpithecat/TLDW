"use client";

import { useState } from "react";
import { UrlInput } from "@/components/url-input";
import { TopicCard } from "@/components/topic-card";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { YouTubePlayer } from "@/components/youtube-player";
import { Topic, TranscriptSegment } from "@/lib/types";
import { extractVideoId } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [seekToTime, setSeekToTime] = useState<number | undefined>();

  const processVideo = async (url: string) => {
    setIsLoading(true);
    setError("");
    
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }
      
      setVideoId(extractedVideoId);
      
      // Fetch transcript
      const transcriptRes = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      
      if (!transcriptRes.ok) {
        const errorData = await transcriptRes.json();
        throw new Error(errorData.error || "Failed to fetch transcript");
      }
      
      const { transcript: fetchedTranscript } = await transcriptRes.json();
      setTranscript(fetchedTranscript);
      
      // Generate topics
      const topicsRes = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          transcript: fetchedTranscript,
          videoId: extractedVideoId
        }),
      });
      
      if (!topicsRes.ok) {
        const errorData = await topicsRes.json();
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
    setSeekToTime(seconds);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">TLDW</h1>
          <p className="text-gray-600">Too Long; Didn't Watch - Smart Video Navigation</p>
        </header>

        <div className="flex justify-center mb-8">
          <UrlInput onSubmit={processVideo} isLoading={isLoading} />
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">Analyzing video and generating topics...</p>
            <p className="text-sm text-gray-500 mt-2">This may take a minute</p>
          </div>
        )}

        {videoId && topics.length > 0 && !isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="mb-6">
                <YouTubePlayer
                  videoId={videoId}
                  selectedTopic={selectedTopic}
                  seekToTime={seekToTime}
                />
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-4">Topics Found</h2>
                <div className="space-y-3">
                  {topics.map((topic) => (
                    <TopicCard
                      key={topic.id}
                      topic={topic}
                      isSelected={selectedTopic?.id === topic.id}
                      onClick={() => setSelectedTopic(topic)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">
                Transcript
                {selectedTopic && (
                  <span className="ml-2 text-sm font-normal text-gray-600">
                    - Highlighting: {selectedTopic.title}
                  </span>
                )}
              </h2>
              <div className="h-[600px] sticky top-8">
                <TranscriptViewer
                  transcript={transcript}
                  selectedTopic={selectedTopic}
                  onTimestampClick={handleTimestampClick}
                />
              </div>
            </div>
          </div>
        )}

        {!isLoading && !error && topics.length === 0 && !videoId && (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-2">
              Enter a YouTube URL above to get started
            </p>
            <p className="text-sm text-gray-500">
              We'll analyze the video and create smart topics for efficient navigation
            </p>
          </div>
        )}
      </div>
    </div>
  );
}