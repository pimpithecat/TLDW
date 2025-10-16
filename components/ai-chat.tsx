"use client";

import { useState, useRef, useEffect, ReactNode, useCallback, RefObject } from "react";
import { ChatMessage, TranscriptSegment, Topic, Citation, NoteSource, NoteMetadata } from "@/lib/types";
import { SelectionActions, SelectionActionPayload, triggerExplainSelection, EXPLAIN_SELECTION_EVENT } from "@/components/selection-actions";
import { ChatMessageComponent } from "./chat-message";
import { SuggestedQuestions } from "./suggested-questions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Send, Loader2 } from "lucide-react";
import { parseTimestamp } from "@/lib/timestamp-utils";
import { formatDuration } from "@/lib/utils";

interface AIChatProps {
  transcript: TranscriptSegment[];
  topics: Topic[];
  videoId: string;
  videoTitle?: string;
  onCitationClick: (citation: Citation) => void;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
  onPlayAllCitations?: (citations: Citation[]) => void;
  cachedSuggestedQuestions?: string[] | null;
  pinnedContent?: ReactNode;
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
}

export function AIChat({ transcript, topics, videoId, videoTitle, onCitationClick, onTimestampClick, onPlayAllCitations, cachedSuggestedQuestions, pinnedContent, onSaveNote, onTakeNoteFromSelection }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [askedQuestions, setAskedQuestions] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const takeawaysContainerRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset questions when video changes
  useEffect(() => {
    setSuggestedQuestions([]);
    setAskedQuestions(new Set());
  }, [videoId]);

  // Update suggested questions when cached questions change
  useEffect(() => {
    if (cachedSuggestedQuestions && cachedSuggestedQuestions.length > 0) {
      setSuggestedQuestions(cachedSuggestedQuestions);
    }
  }, [cachedSuggestedQuestions]);

  // Only fetch new questions if we don't have cached ones
  useEffect(() => {
    if (transcript.length > 0 && suggestedQuestions.length === 0 && !cachedSuggestedQuestions) {
      fetchSuggestedQuestions();
    }
  }, [transcript, cachedSuggestedQuestions]);

  const sendMessage = useCallback(async (messageText?: string, retryCount = 0) => {
    const text = messageText || input.trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    // Only add user message on first attempt
    if (retryCount === 0) {
      setMessages(prev => [...prev, userMessage]);
      setInput("");
      // Track if this was a suggested question
      if (messageText) {
        setAskedQuestions(prev => new Set(prev).add(messageText));
      }
    }
    setIsLoading(true);

    try {
      // Add timeout controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          transcript,
          topics,
          videoId,
          chatHistory: messages,
          model: 'gemini-2.5-flash-lite',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Check if it's a rate limit or temporary error
        if (response.status === 429 || response.status === 503) {
          throw new Error("Service temporarily unavailable");
        }
        throw new Error(`Failed to get response (${response.status})`);
      }

      const data = await response.json();
      
      // Validate response has content
      if (!data.content || data.content.trim() === "") {
        throw new Error("Empty response received");
      }
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.content,
        citations: data.citations || [],
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      
      // Retry logic for temporary failures
      const errorName = error instanceof Error ? error.name : '';
      const errorMessage = error instanceof Error ? error.message : '';
      if (retryCount < 2 && (
        errorName === 'AbortError' ||
        errorMessage.includes('temporarily unavailable') ||
        errorMessage.includes('Empty response')
      )) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)));
        return sendMessage(text, retryCount + 1);
      }
      
      // Provide specific error messages
      let errorContent = "Sorry, I encountered an error processing your request.";
      
      if (errorName === 'AbortError') {
        errorContent = "The request took too long to process. Please try again with a simpler question.";
      } else if (errorMessage.includes('temporarily unavailable')) {
        errorContent = "The AI service is temporarily unavailable. Please try again in a moment.";
      } else if (errorMessage.includes('Empty response')) {
        errorContent = "I couldn't generate a proper response. Please try rephrasing your question.";
      }
      
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: errorContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, transcript, topics, videoId]);

  useEffect(() => {
    const handleExplain = (event: Event) => {
      const custom = event as CustomEvent<SelectionActionPayload>;
      const detail = custom.detail;
      if (!detail?.text?.trim()) {
        return;
      }

      const origin =
        detail.source === 'transcript'
          ? 'transcript excerpt'
          : detail.source === 'takeaways'
            ? 'takeaway insight'
            : 'text';

      const contextLines: string[] = [];

      if (detail.source === 'takeaways') {
        contextLines.push('Source: Key takeaways summary (paraphrased from the transcript)');
      }

      if (detail.metadata?.timestampLabel) {
        contextLines.push(`Timestamp: ${detail.metadata.timestampLabel}`);
      }

      if (detail.metadata?.transcript?.start !== undefined) {
        const transcriptStart = detail.metadata.transcript.start;
        const transcriptEnd = detail.metadata.transcript.end ?? transcriptStart;
        const startLabel = formatDuration(transcriptStart);
        const endLabel = formatDuration(transcriptEnd);
        contextLines.push(
          transcriptEnd === transcriptStart
            ? `Transcript reference: ${startLabel}`
            : `Transcript window: ${startLabel} - ${endLabel}`
        );
      }

      if (detail.metadata?.selectionContext && detail.metadata.selectionContext !== videoTitle) {
        contextLines.push(`Context: ${detail.metadata.selectionContext}`);
      }

      const additionalDetails = contextLines.length
        ? `

Additional details:
- ${contextLines.join('\n- ')}`
        : '';

      let prompt = `Explain the following ${origin}${videoTitle ? ` from "${videoTitle}"` : ''}:

"${detail.text}"${additionalDetails}`;

      const extra = detail.metadata?.extra as Record<string, unknown> | undefined;
      const fullTakeawayText = typeof extra?.fullTakeawayText === 'string'
        ? extra.fullTakeawayText.trim()
        : '';

      if (
        detail.source === 'takeaways' &&
        fullTakeawayText &&
        fullTakeawayText.toLowerCase() !== detail.text.trim().toLowerCase()
      ) {
        prompt += `

Full takeaway context: "${fullTakeawayText}"`;
      }

      sendMessage(prompt);
    };

    window.addEventListener(EXPLAIN_SELECTION_EVENT, handleExplain as EventListener);
    return () => {
      window.removeEventListener(EXPLAIN_SELECTION_EVENT, handleExplain as EventListener);
    };
  }, [sendMessage, videoTitle]);


  const fetchSuggestedQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const response = await fetch("/api/suggested-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, topics, videoTitle }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setSuggestedQuestions(data.questions || []);
      }
    } catch (error) {
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRetry = useCallback((messageId: string) => {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex > 0) {
      const userMessage = messages[messageIndex - 1];
      if (userMessage.role === 'user') {
        // Remove the assistant message being retried
        setMessages(prev => prev.filter((_, i) => i !== messageIndex));
        // Pass retryCount > 0 to prevent re-adding the user message
        sendMessage(userMessage.content, 1);
      }
    }
  }, [messages, sendMessage]);

  const findSegmentByTime = useCallback((seconds: number) => {
    if (!transcript || transcript.length === 0) {
      return null;
    }

    for (let i = 0; i < transcript.length; i++) {
      const segment = transcript[i];
      const segmentEnd = segment.start + segment.duration;
      if (seconds >= segment.start && seconds <= segmentEnd) {
        return { segment, index: i };
      }
    }

    let closestIndex = 0;
    let minDiff = Math.abs(transcript[0].start - seconds);
    for (let i = 1; i < transcript.length; i++) {
      const diff = Math.abs(transcript[i].start - seconds);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    const fallbackSegment = transcript[closestIndex];
    return fallbackSegment ? { segment: fallbackSegment, index: closestIndex } : null;
  }, [transcript]);

  const getTakeawayMetadata = useCallback((range: Range) => {
    const container = takeawaysContainerRef.current;
    if (!container) {
      return undefined;
    }

    const startNode = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer?.parentElement ?? null;

    if (!startNode || !container.contains(startNode)) {
      return undefined;
    }

    const listItem = startNode.closest('li');
    if (!listItem) {
      return undefined;
    }

    const metadata: NoteMetadata = {};
    const strongLabel = listItem.querySelector('strong');
    if (strongLabel?.textContent) {
      metadata.selectionContext = strongLabel.textContent.trim();
    }

    const textContent = listItem.textContent?.trim() ?? '';
    if (textContent) {
      const timestampMatches = Array.from(textContent.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g));
      const timestampSeconds: number[] = [];
      const timestampLabels: string[] = [];

      for (const match of timestampMatches) {
        const tsString = match[0];
        const seconds = parseTimestamp(tsString);
        if (seconds !== null) {
          timestampSeconds.push(seconds);
          timestampLabels.push(formatDuration(seconds));
        }
      }

      if (timestampLabels.length > 0) {
        metadata.timestampLabel = timestampLabels.join(', ');
        const firstSeconds = timestampSeconds[0];
        const segmentInfo = findSegmentByTime(firstSeconds);
        if (segmentInfo) {
          metadata.transcript = {
            start: segmentInfo.segment.start,
            end: segmentInfo.segment.start + segmentInfo.segment.duration,
            segmentIndex: segmentInfo.index,
          };
        }
        metadata.extra = {
          ...(metadata.extra || {}),
          takeawayTimestamps: timestampSeconds,
          fullTakeawayText: textContent,
        };
      } else {
        metadata.extra = {
          ...(metadata.extra || {}),
          fullTakeawayText: textContent,
        };
      }
    }

    return metadata;
  }, [findSegmentByTime]);


  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      <div className="w-full h-full flex flex-col">
        <ScrollArea className="flex-1 px-6" ref={scrollRef}>
          <div className="space-y-3.5" ref={chatContainerRef}>
            {pinnedContent && (
              <div className="space-y-2.5" ref={takeawaysContainerRef}>
                <SelectionActions
                  containerRef={takeawaysContainerRef as unknown as RefObject<HTMLElement | null>}
                  onExplain={(payload) => {
                    triggerExplainSelection({
                      ...payload,
                      source: 'takeaways'
                    });
                  }}
                  onTakeNote={(payload) => {
                    onTakeNoteFromSelection?.({
                      ...payload,
                      source: 'takeaways'
                    });
                  }}
                  getMetadata={getTakeawayMetadata}
                  source="takeaways"
                />
                {pinnedContent}
              </div>
            )}
            <div ref={chatMessagesContainerRef}>
              <SelectionActions
                containerRef={chatMessagesContainerRef as unknown as RefObject<HTMLElement | null>}
                onExplain={(payload) => {
                  triggerExplainSelection({
                    ...payload,
                    source: 'chat'
                  });
                }}
                onTakeNote={(payload) => {
                  onTakeNoteFromSelection?.({
                    ...payload,
                    source: 'chat'
                  });
                }}
                source="chat"
              />
              {messages.map((message) => (
              <ChatMessageComponent
                key={message.id}
                message={message}
                onCitationClick={onCitationClick}
                onTimestampClick={onTimestampClick}
                onRetry={message.role === 'assistant' ? handleRetry : undefined}
                onSaveNote={message.role === 'assistant' ? onSaveNote : undefined}
              />
              ))}
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 mb-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Thinking...</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {suggestedQuestions.length > 0 && (
          <div className="px-6">
            <SuggestedQuestions
              questions={suggestedQuestions}
              onQuestionClick={sendMessage}
              isLoading={loadingQuestions}
              askedQuestions={askedQuestions}
            />
          </div>
        )}

        <div className="px-6 pt-[18px] pb-6">
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the video..."
              className="resize-none rounded-[20px] text-xs bg-neutral-100 border-[#ebecee] pr-11"
              rows={2}
              disabled={isLoading}
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="absolute right-2 bottom-2 rounded-full h-8 w-8"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
