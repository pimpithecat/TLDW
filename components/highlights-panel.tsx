"use client";

import { Topic, TranscriptSegment } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { VideoProgressBar } from "@/components/video-progress-bar";
import { formatDuration } from "@/lib/utils";

interface HighlightsPanelProps {
  topics: Topic[];
  selectedTopic: Topic | null;
  onTopicSelect: (topic: Topic) => void;
  onPlayTopic?: (topic: Topic) => void;
  onSeek: (time: number) => void;
  onPlayAll: () => void;
  isPlayingAll: boolean;
  playAllIndex?: number;
  currentTime: number;
  videoDuration: number;
  transcript?: TranscriptSegment[];
}

export function HighlightsPanel({
  topics,
  selectedTopic,
  onTopicSelect,
  onPlayTopic,
  onSeek,
  onPlayAll,
  isPlayingAll,
  playAllIndex = 0,
  currentTime,
  videoDuration,
  transcript = [],
}: HighlightsPanelProps) {
  return (
    <Card className="overflow-hidden shadow-sm p-0">
      <div className="p-3 bg-background border-t flex-shrink-0">
        {videoDuration > 0 && (
          <VideoProgressBar
            videoDuration={videoDuration}
            currentTime={currentTime}
            topics={topics}
            selectedTopic={selectedTopic}
            onSeek={onSeek}
            onTopicSelect={(topic) => onTopicSelect(topic)}
            onPlayTopic={onPlayTopic}
            transcript={transcript}
            onPlayAllTopics={onPlayAll}
            isPlayingAll={isPlayingAll}
            playAllIndex={playAllIndex}
          />
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="ml-3 flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">
              {formatDuration(currentTime)} / {formatDuration(videoDuration)}
            </span>
          </div>
          <div className="flex items-center gap-2" />
        </div>
      </div>
    </Card>
  );
}
