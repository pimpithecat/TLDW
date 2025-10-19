"use client";

import { useState, useRef, useEffect, useCallback, RefObject } from "react";
import { z } from "zod";
import { ChatMessage, TranscriptSegment, Topic, Citation, NoteSource, NoteMetadata, VideoInfo } from "@/lib/types";
import { SelectionActions, SelectionActionPayload, triggerExplainSelection, EXPLAIN_SELECTION_EVENT } from "@/components/selection-actions";
import { ChatMessageComponent } from "./chat-message";
import { SuggestedQuestions } from "./suggested-questions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Send, Loader2 } from "lucide-react";

const KEY_TAKEAWAYS_LABEL = "What are the key takeaways?";
const TOP_QUOTES_LABEL = "What are the juciest quotes?";
const PRESET_KEY_TAKEAWAYS = "__preset_key_takeaways__";
const PRESET_TOP_QUOTES = "__preset_top_quotes__";

function normalizeBracketTimestamps(text: string): string {
  return text.replace(/\((\d{1,2}:\d{2}(?::\d{2})?(?:\s*,\s*\d{1,2}:\d{2}(?::\d{2})?)*)\)/g, (_, group) => {
    const parts = group.split(/\s*,\s*/);
    return parts.map((part: string) => `[${part}]`).join(', ');
  });
}

type SuggestedMessage = string | {
  prompt: string;
  display?: string;
  askedLabel?: string;
};

const citationSchema = z.object({
  number: z.number(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  startSegmentIdx: z.number(),
  endSegmentIdx: z.number(),
  startCharOffset: z.number(),
  endCharOffset: z.number(),
});

const chatApiResponseSchema = z.object({
  content: z.string().min(1, "Empty response received"),
  citations: z.array(citationSchema).optional(),
});

const summaryResponseSchema = z.union([
  z.object({ summaryContent: z.string().min(1) }),
  z.object({ summary: z.string().min(1) }),
]);

interface AIChatProps {
  transcript: TranscriptSegment[];
  topics: Topic[];
  videoId: string;
  videoTitle?: string;
  videoInfo?: VideoInfo | null;
  onCitationClick: (citation: Citation) => void;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
  cachedSuggestedQuestions?: string[] | null;
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
}

export function AIChat({ transcript, topics, videoId, videoTitle, videoInfo, onCitationClick, onTimestampClick, cachedSuggestedQuestions, onSaveNote, onTakeNoteFromSelection }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [askedQuestions, setAskedQuestions] = useState<Set<string>>(new Set());
  const chatMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const presetPromptMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }
    
    // Scroll to bottom of viewport only
    const scrollToBottom = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };

    if (messages.length <= 1) {
      scrollToBottom();
    } else {
      // Smooth scroll for subsequent messages
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isLoading]);

  // Reset questions when video changes
  useEffect(() => {
    setSuggestedQuestions([]);
    setAskedQuestions(new Set());
    presetPromptMapRef.current.clear();
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

  const sendMessage = useCallback(async (messageInput?: SuggestedMessage, retryCount = 0) => {
    const isObjectInput = typeof messageInput === "object" && messageInput !== null;
    const promptText = isObjectInput
      ? messageInput.prompt
      : typeof messageInput === "string"
        ? messageInput
        : input.trim();

    const displayText = isObjectInput
      ? messageInput.display ?? messageInput.prompt
      : typeof messageInput === "string"
        ? messageInput
        : input.trim();

    const askedLabel = isObjectInput
      ? messageInput.askedLabel ?? messageInput.display ?? messageInput.prompt
      : typeof messageInput === "string"
        ? messageInput
        : undefined;

    if (!promptText || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: displayText,
      timestamp: new Date(),
    };

    // Only add user message on first attempt
    if (retryCount === 0) {
      setMessages(prev => [...prev, userMessage]);
      setInput("");
      if (askedLabel) {
        setAskedQuestions(prev => {
          const next = new Set(prev);
          next.add(askedLabel);
          return next;
        });
      }
      if (displayText && promptText) {
        presetPromptMapRef.current.set(displayText, promptText);
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
          message: promptText,
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

      const rawData = await response.json();
      const parsedData = chatApiResponseSchema.parse(rawData);
      const normalizedContent = normalizeBracketTimestamps(parsedData.content);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: normalizedContent,
        citations: parsedData.citations || [],
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
        return sendMessage(
          isObjectInput ? messageInput : promptText,
          retryCount + 1
        );
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

  const executeKeyTakeaways = useCallback(
    async ({ skipUserMessage = false }: { skipUserMessage?: boolean } = {}) => {
      if (transcript.length === 0) {
        return;
      }

      if (isLoading) {
        return;
      }

      if (!skipUserMessage && askedQuestions.has(KEY_TAKEAWAYS_LABEL)) {
        return;
      }

      presetPromptMapRef.current.set(KEY_TAKEAWAYS_LABEL, PRESET_KEY_TAKEAWAYS);

      if (!skipUserMessage) {
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: "user",
          content: KEY_TAKEAWAYS_LABEL,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);
      }

      setAskedQuestions(prev => {
        const next = new Set(prev);
        next.add(KEY_TAKEAWAYS_LABEL);
        return next;
      });

      setIsLoading(true);

      try {
        const requestVideoInfo: Partial<VideoInfo> = {
          title: videoInfo?.title ?? videoTitle ?? "Untitled video",
          author: videoInfo?.author,
          description: videoInfo?.description,
        };

        const summaryResponse = await fetch("/api/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            videoInfo: requestVideoInfo,
            videoId,
          }),
        });

        if (!summaryResponse.ok) {
          const errorData = await summaryResponse.json().catch(() => ({}));
          const errorText = typeof errorData.error === "string" ? errorData.error : "Failed to generate takeaways.";
          throw new Error(errorText);
        }

        const rawSummary = await summaryResponse.json();
        const parsedSummary = summaryResponseSchema.parse(rawSummary);
        const content = 'summaryContent' in parsedSummary
          ? parsedSummary.summaryContent
          : parsedSummary.summary;

        const normalizedContent = normalizeBracketTimestamps(content);

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: normalizedContent,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to generate takeaways. Please try again.";

        setMessages(prev => [...prev, {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
        }]);

        setAskedQuestions(prev => {
          const next = new Set(prev);
          next.delete(KEY_TAKEAWAYS_LABEL);
          return next;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [askedQuestions, isLoading, transcript, videoInfo, videoId, videoTitle]
  );

  const executeTopQuotes = useCallback(
    async ({ skipUserMessage = false }: { skipUserMessage?: boolean } = {}) => {
      if (transcript.length === 0) {
        return;
      }

      if (isLoading) {
        return;
      }

      if (!skipUserMessage && askedQuestions.has(TOP_QUOTES_LABEL)) {
        return;
      }

      presetPromptMapRef.current.set(TOP_QUOTES_LABEL, PRESET_TOP_QUOTES);

      if (!skipUserMessage) {
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: "user",
          content: TOP_QUOTES_LABEL,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);
      }

      setAskedQuestions(prev => {
        const next = new Set(prev);
        next.add(TOP_QUOTES_LABEL);
        return next;
      });

      setIsLoading(true);

      try {
        const requestVideoInfo: Partial<VideoInfo> = {
          title: videoInfo?.title ?? videoTitle ?? "Untitled video",
          author: videoInfo?.author,
          description: videoInfo?.description,
        };

        const response = await fetch("/api/top-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            videoInfo: requestVideoInfo,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorText = typeof errorData.error === "string" ? errorData.error : "Failed to generate top quotes.";
          throw new Error(errorText);
        }

        const data = await response.json();
        const content = typeof data.quotesMarkdown === "string" && data.quotesMarkdown.trim().length > 0
          ? data.quotesMarkdown
          : null;

        if (!content) {
          throw new Error("No quotes were returned. Please try again.");
        }

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to generate top quotes. Please try again.";

        setMessages(prev => [...prev, {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
        }]);

        setAskedQuestions(prev => {
          const next = new Set(prev);
          next.delete(TOP_QUOTES_LABEL);
          return next;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [askedQuestions, isLoading, transcript, videoInfo, videoTitle]
  );

  const handleAskKeyTakeaways = useCallback(() => {
    void executeKeyTakeaways();
  }, [executeKeyTakeaways]);

  const handleAskTopQuotes = useCallback(() => {
    void executeTopQuotes();
  }, [executeTopQuotes]);

  useEffect(() => {
    const handleExplain = (event: Event) => {
      const custom = event as CustomEvent<SelectionActionPayload>;
      const detail = custom.detail;
      if (!detail?.text?.trim()) {
        return;
      }

      const prompt = `Explain "${detail.text.trim()}"`;

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
        const presetPrompt = presetPromptMapRef.current.get(userMessage.content);
        if (presetPrompt === PRESET_KEY_TAKEAWAYS) {
          void executeKeyTakeaways({ skipUserMessage: true });
          return;
        }
        if (presetPrompt === PRESET_TOP_QUOTES) {
          void executeTopQuotes({ skipUserMessage: true });
          return;
        }
        if (typeof presetPrompt === "string") {
          sendMessage({
            prompt: presetPrompt,
            display: userMessage.content,
            askedLabel: userMessage.content,
          }, 1);
        } else {
          sendMessage(userMessage.content, 1);
        }
      }
    }
  }, [messages, executeKeyTakeaways, executeTopQuotes, sendMessage]);

  const hasAskedKeyTakeaways = askedQuestions.has(KEY_TAKEAWAYS_LABEL);
  const hasAskedTopQuotes = askedQuestions.has(TOP_QUOTES_LABEL);

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      <div className="w-full h-full flex flex-col">
        <ScrollArea className="flex-1 px-6" ref={(node) => {
          if (node) {
            // Radix ScrollArea has a viewport element as its first child
            const viewport = node.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement;
            scrollViewportRef.current = viewport;
          }
        }}>
          <div className="space-y-3.5 pt-3">
            <div className="flex w-full flex-col items-end gap-2">
              <Button
                variant="pill"
                size="sm"
                onClick={handleAskKeyTakeaways}
                disabled={isLoading || hasAskedKeyTakeaways || transcript.length === 0}
                className="self-end w-fit max-w-full sm:max-w-[80%] h-auto justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
              >
                {KEY_TAKEAWAYS_LABEL}
              </Button>
              <Button
                variant="pill"
                size="sm"
                onClick={handleAskTopQuotes}
                disabled={isLoading || hasAskedTopQuotes || transcript.length === 0}
                className="self-end w-fit max-w-full sm:max-w-[80%] h-auto justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
              >
                {TOP_QUOTES_LABEL}
              </Button>
              <SuggestedQuestions
                questions={suggestedQuestions}
                onQuestionClick={sendMessage}
                isLoading={loadingQuestions}
                isChatLoading={isLoading}
                askedQuestions={askedQuestions}
              />
            </div>
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
            <div ref={messagesEndRef} className="pb-24" />
          </div>
        </ScrollArea>
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
