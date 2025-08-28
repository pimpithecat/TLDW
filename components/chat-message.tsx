"use client";

import { ChatMessage, Citation } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Bot } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageProps {
  message: ChatMessage;
  onTimestampClick: (seconds: number) => void;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function ChatMessageComponent({ message, onTimestampClick }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary/10' : 'bg-muted'
      }`}>
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      
      <div className={`flex-1 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <Card className={`p-4 ${isUser ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'}`}>
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                  code: ({ className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    return match ? (
                      <pre className="bg-background/50 p-2 rounded overflow-x-auto mb-2">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    ) : (
                      <code className="bg-background/50 px-1 py-0.5 rounded text-xs" {...props}>
                        {children}
                      </code>
                    );
                  },
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic mb-2">
                      {children}
                    </blockquote>
                  ),
                  h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-base font-semibold mb-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mb-2">{children}</h3>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          
          {message.citations && message.citations.length > 0 && !isUser && (
            <div className="mt-4 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-muted-foreground font-medium">Citations:</p>
                <div className="flex flex-wrap gap-1">
                  {message.citations.map((citation, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs font-medium"
                      onClick={() => onTimestampClick(citation.timestamp)}
                    >
                      [{idx + 1}]
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {message.citations.map((citation, idx) => (
                  <div
                    key={idx}
                    className="text-xs text-muted-foreground border-l-2 border-muted pl-3 py-1 cursor-pointer hover:bg-background/50 rounded-r transition-colors"
                    onClick={() => onTimestampClick(citation.timestamp)}
                  >
                    <span className="font-medium text-foreground">
                      [{idx + 1}] {formatTimestamp(citation.timestamp)}
                    </span>
                    {citation.endTime && (
                      <span className="font-medium text-foreground">
                        -{formatTimestamp(citation.endTime)}
                      </span>
                    )}
                    : "{citation.text}"
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}