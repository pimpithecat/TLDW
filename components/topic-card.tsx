"use client";

import { Clock, Play, Quote } from "lucide-react";
import { Topic } from "@/lib/types";
import { formatTopicDuration, getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  onClick: () => void;
  topicIndex: number;
  onPlayTopic?: () => void;
}

export function TopicCard({ topic, isSelected, onClick, topicIndex, onPlayTopic }: TopicCardProps) {
  const topicColor = getTopicHSLColor(topicIndex);
  
  return (
    <Card 
      className={cn(
        "w-full cursor-pointer transition-all duration-200",
        "hover:shadow-lg hover:scale-[1.02]",
        isSelected && "ring-2 shadow-lg scale-[1.02]"
      )}
      style={{
        borderColor: isSelected ? `hsl(${topicColor})` : undefined,
        backgroundColor: isSelected ? `hsl(${topicColor} / 0.05)` : undefined,
        ringColor: isSelected ? `hsl(${topicColor})` : undefined,
      }}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: `hsl(${topicColor})` }}
              />
              {topic.title}
            </CardTitle>
            <CardDescription className="text-sm">
              {topic.description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              {formatTopicDuration(topic.duration)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Segments indicator */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {topic.segments.length} segment{topic.segments.length !== 1 ? 's' : ''}
            </span>
            {topic.quotes && topic.quotes.length > 0 && (
              <Badge variant="outline" className="text-xs">
                <Quote className="w-3 h-3 mr-1" />
                {topic.quotes.length} quote{topic.quotes.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          
          {/* Visual segment indicator */}
          <div className="flex gap-1 h-1">
            {topic.segments.slice(0, 10).map((_, index) => (
              <div
                key={index}
                className="flex-1 rounded-full"
                style={{ 
                  backgroundColor: `hsl(${topicColor} / ${0.3 + (index * 0.07)})` 
                }}
              />
            ))}
            {topic.segments.length > 10 && (
              <span className="text-xs text-muted-foreground">+{topic.segments.length - 10}</span>
            )}
          </div>
          
          {/* Quote preview */}
          {topic.quotes && topic.quotes.length > 0 && (
            <div 
              className="text-xs italic p-2 rounded-md border-l-2"
              style={{
                backgroundColor: `hsl(${topicColor} / 0.05)`,
                borderColor: `hsl(${topicColor} / 0.5)`,
              }}
            >
              <Quote className="w-3 h-3 mb-1 opacity-50" />
              "{topic.quotes[0].text.length > 120 
                ? topic.quotes[0].text.substring(0, 120) + '...' 
                : topic.quotes[0].text}"
            </div>
          )}
          
          {/* Play button */}
          {isSelected && onPlayTopic && (
            <Button
              size="sm"
              className="w-full"
              style={{
                backgroundColor: `hsl(${topicColor})`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPlayTopic();
              }}
            >
              <Play className="w-4 h-4 mr-2" />
              Play All Segments
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}