"use client";

import { Clock } from "lucide-react";
import { Topic } from "@/lib/types";
import { formatTopicDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  onClick: () => void;
}

export function TopicCard({ topic, isSelected, onClick }: TopicCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-lg border transition-all",
        "hover:shadow-md hover:border-blue-300",
        isSelected && "border-blue-500 bg-blue-50 shadow-md"
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-lg flex-1 pr-2">
          {topic.title}
        </h3>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <Clock className="w-4 h-4" />
          <span>{formatTopicDuration(topic.duration)}</span>
        </div>
      </div>
      <p className="text-gray-600 text-sm">
        {topic.description}
      </p>
      <div className="mt-3 space-y-2">
        <div className="text-xs text-gray-500">
          {topic.quotes && topic.quotes.length > 0 
            ? `${topic.quotes.length} key quote${topic.quotes.length !== 1 ? 's' : ''}`
            : `${topic.segments.length} segment${topic.segments.length !== 1 ? 's' : ''} found`
          }
        </div>
        {/* Show first quote as preview */}
        {topic.quotes && topic.quotes.length > 0 && (
          <div className="text-xs text-gray-600 italic border-l-2 border-gray-300 pl-2">
            "{topic.quotes[0].text.length > 150 
              ? topic.quotes[0].text.substring(0, 150) + '...' 
              : topic.quotes[0].text}"
          </div>
        )}
      </div>
    </button>
  );
}