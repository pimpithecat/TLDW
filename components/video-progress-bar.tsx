"use client";

import { useEffect, useState, useRef } from "react";
import { Topic, TranscriptSegment } from "@/lib/types";
import { formatDuration, getTopicHSLColor } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VideoProgressBarProps {
  videoDuration: number;
  currentTime: number;
  topics: Topic[];
  selectedTopic: Topic | null;
  onSeek: (time: number) => void;
  onTopicSelect?: (topic: Topic) => void;
  transcript?: TranscriptSegment[];
}

export function VideoProgressBar({
  videoDuration,
  currentTime,
  topics,
  selectedTopic,
  onSeek,
  onTopicSelect,
  transcript,
}: VideoProgressBarProps) {
  const [hoveredSegment, setHoveredSegment] = useState<{
    topic: Topic;
    segment: Topic["segments"][0];
    x: number;
  } | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * videoDuration;
    onSeek(time);
  };

  const handleSegmentHover = (
    topic: Topic,
    segment: Topic["segments"][0],
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredSegment({
      topic,
      segment,
      x: rect.left + rect.width / 2,
    });
  };

  // Calculate topic density heatmap
  const calculateDensity = () => {
    if (!videoDuration) return [];
    const buckets = 100; // Number of heatmap segments
    const bucketSize = videoDuration / buckets;
    const density = new Array(buckets).fill(0);

    topics.forEach((topic) => {
      topic.segments.forEach((segment) => {
        const startBucket = Math.floor(segment.start / bucketSize);
        const endBucket = Math.min(
          Math.floor(segment.end / bucketSize),
          buckets - 1
        );
        for (let i = startBucket; i <= endBucket; i++) {
          density[i]++;
        }
      });
    });

    const maxDensity = Math.max(...density);
    return density.map((d) => d / maxDensity);
  };

  const density = calculateDensity();

  // Flatten segments for rendering without nested maps
  const allSegments = topics.flatMap((topic, topicIndex) =>
    topic.segments.map((segment, segmentIndex) => ({
      key: `${topic.id}-${segmentIndex}`,
      topic,
      topicIndex,
      segment,
      segmentIndex,
    }))
  );

  return (
    <TooltipProvider>
      <div className="relative w-full space-y-2">
        {/* Main progress bar */}
        <div
          ref={progressBarRef}
          className="relative h-12 bg-muted rounded-lg overflow-hidden cursor-pointer group"
          onClick={handleClick}
        >
          {/* Heatmap background */}
          <div className="absolute inset-0 flex">
            {density.map((d, i) => (
              <div
                key={i}
                className="flex-1 h-full transition-opacity"
                style={{
                  backgroundColor: `hsl(var(--primary) / ${d * 0.2})`,
                }}
              />
            ))}
          </div>

          {/* Topic segments */}
          <div className="absolute inset-0">
            {allSegments.map(({ key, topic, topicIndex, segment }) => {
              const startPercentage = (segment.start / videoDuration) * 100;
              const widthPercentage =
                ((segment.end - segment.start) / videoDuration) * 100;
              const isSelected = selectedTopic?.id === topic.id;

              return (
                <div
                  key={key}
                  className={cn(
                    "absolute top-2 h-8 rounded-md transition-all cursor-pointer group/segment",
                    "hover:z-10 hover:scale-y-110",
                    isSelected && "z-10 ring-2 ring-white"
                  )}
                  style={{
                    left: `${startPercentage}%`,
                    width: `${widthPercentage}%`,
                    backgroundColor: `hsl(${getTopicHSLColor(topicIndex)})`,
                    opacity: isSelected ? 1 : 0.7,
                  }}
                  title={`${topic.title}\n${formatDuration(segment.start)} - ${formatDuration(segment.end)}`}
                  onMouseEnter={(e) => handleSegmentHover(topic, segment, e)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(segment.start);
                    onTopicSelect?.(topic);
                  }}
                />
              );
            })}
          </div>

          {/* Current time indicator */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none transition-all"
            style={{
              left: `${(currentTime / videoDuration) * 100}%`,
            }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
          </div>
        </div>

        {/* Time labels */}
        <div className="flex justify-between text-xs text-muted-foreground px-1">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(videoDuration)}</span>
        </div>

        {/* Topic color legend */}
        <div className="flex flex-wrap gap-2 mt-4">
          {topics.map((topic, index) => (
            <button
              key={topic.id}
              className={cn(
                "px-2 py-1 rounded-md text-xs font-medium transition-all",
                "hover:scale-105",
                selectedTopic?.id === topic.id && "ring-2 ring-offset-2"
              )}
              style={{
                backgroundColor: `hsl(${getTopicHSLColor(index)} / 0.2)`,
                borderColor: `hsl(${getTopicHSLColor(index)})`,
                borderWidth: "1px",
                borderStyle: "solid",
              }}
              onClick={() => onTopicSelect?.(topic)}
            >
              {topic.title}
            </button>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}