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
        "w-full px-2.5 py-1.5 rounded-2xl",
        "flex items-center justify-between gap-3",
        "transition-all duration-200",
        "hover:scale-[1.01] hover:shadow-[0px_0px_12px_0px_rgba(0,0,0,0.1)]",
        "text-left",
        isSelected ? "border-[2px] scale-[1.01] shadow-[0px_0px_12px_0px_rgba(0,0,0,0.1)]" : "border",
      )}
      style={{
        borderColor: `hsl(${topicColor})`,
        backgroundColor: isSelected
          ? `hsl(${topicColor} / 0.15)`
          : `hsl(${topicColor} / 0.08)`,
      }}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div 
          className={cn(
            "rounded-full shrink-0 transition-all",
            isSelected ? "w-4 h-4" : "w-3.5 h-3.5"
          )}
          style={{ backgroundColor: `hsl(${topicColor})` }}
        />
        <span className="font-medium text-sm truncate">
          {topic.title}
        </span>
      </div>
      
      <span className="font-mono text-xs text-muted-foreground shrink-0">
        {formatDuration(topic.duration)}
      </span>
    </button>
  );
}