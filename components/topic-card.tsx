"use client";

import { Topic } from "@/lib/types";
import { formatDuration, getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  onClick: () => void;
  topicIndex: number;
  onPlayTopic?: () => void;
}

export function TopicCard({ topic, isSelected, onClick, topicIndex, onPlayTopic }: TopicCardProps) {
  const topicColor = getTopicHSLColor(topicIndex);
  
  const handleClick = () => {
    onClick();
    // Automatically play the topic when clicked
    if (onPlayTopic) {
      onPlayTopic();
    }
  };
  
  return (
    <button
      className={cn(
        "w-full px-3 py-2 rounded-lg",
        "flex items-center justify-between gap-4",
        "transition-all duration-200",
        "hover:scale-[1.02] hover:shadow-md",
        "text-left",
        isSelected ? "border-[2px] scale-[1.02] shadow-md" : "border",
      )}
      style={{
        borderColor: `hsl(${topicColor})`,
        backgroundColor: isSelected 
          ? `hsl(${topicColor} / 0.15)` 
          : `hsl(${topicColor} / 0.08)`,
      }}
      onClick={handleClick}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div 
          className={cn(
            "rounded-full shrink-0 transition-all",
            isSelected ? "w-5 h-5" : "w-4 h-4"
          )}
          style={{ backgroundColor: `hsl(${topicColor})` }}
        />
        <span className="font-medium text-base truncate">
          {topic.title}
        </span>
      </div>
      
      <span className="font-mono text-sm text-muted-foreground shrink-0">
        {formatDuration(topic.duration)}
      </span>
    </button>
  );
}