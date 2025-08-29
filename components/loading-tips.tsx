"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Lightbulb, Sparkles, Target, Zap, MessageSquare, Navigation } from "lucide-react";

const TIPS = [
  {
    icon: Sparkles,
    title: "Smart Highlight Reels",
    text: "Unlike traditional summaries, we identify themes that span across the entire video, connecting related insights from different timestamps."
  },
  {
    icon: Target,
    title: "Jump to What Matters",
    text: "Each highlight reel contains exact quotes with timestamps, letting you jump directly to the most valuable insights without watching the entire video."
  },
  {
    icon: MessageSquare,
    title: "Ask Follow-Up Questions",
    text: "Our AI chat understands the full video context. Ask specific questions and get answers with exact timestamps for verification."
  },
  {
    icon: Navigation,
    title: "Non-Linear Navigation",
    text: "Navigate through content based on your interests, not chronological order. Perfect for research, learning, and finding specific information."
  },
  {
    icon: Zap,
    title: "Save Hours of Time",
    text: "What typically takes 30-60 minutes to watch can be understood in 5 minutes with our intelligent highlight system."
  },
  {
    icon: Lightbulb,
    title: "Discover Hidden Connections",
    text: "Our AI identifies relationships between ideas mentioned at different points in the video, revealing insights you might have missed."
  }
];

export function LoadingTips() {
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [shuffledTips, setShuffledTips] = useState(TIPS);

  // Shuffle tips on mount
  useEffect(() => {
    const shuffled = [...TIPS].sort(() => Math.random() - 0.5);
    setShuffledTips(shuffled);
  }, []);

  // Rotate tips
  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      
      setTimeout(() => {
        setCurrentTipIndex((prev) => (prev + 1) % shuffledTips.length);
        setIsVisible(true);
      }, 300);
    }, 4000);

    return () => clearInterval(interval);
  }, [shuffledTips.length]);

  const currentTip = shuffledTips[currentTipIndex];
  const Icon = currentTip.icon;

  return (
    <Card className="p-6 max-w-2xl mx-auto mt-6">
      <div
        className={`transition-all duration-300 ${
          isVisible ? "opacity-100 transform translate-y-0" : "opacity-0 transform -translate-y-2"
        }`}
      >
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          </div>
          
          <div className="flex-1 space-y-1">
            <h4 className="font-medium text-foreground">
              {currentTip.title}
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {currentTip.text}
            </p>
          </div>
        </div>
      </div>

      {/* Tip indicator dots */}
      <div className="flex justify-center gap-1.5 mt-4">
        {shuffledTips.map((_, index) => (
          <div
            key={index}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentTipIndex 
                ? "w-6 bg-primary" 
                : "w-1.5 bg-muted-foreground/30"
            }`}
          />
        ))}
      </div>
    </Card>
  );
}