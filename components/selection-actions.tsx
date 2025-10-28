"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NoteMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface SelectionActionPayload {
  text: string;
  metadata?: NoteMetadata | null;
  source?: "chat" | "transcript" | "takeaways" | string;
}

export const EXPLAIN_SELECTION_EVENT = "tldw-explain-selection";

export function triggerExplainSelection(detail: SelectionActionPayload) {
  if (!detail.text.trim()) return;
  window.dispatchEvent(
    new CustomEvent<SelectionActionPayload>(EXPLAIN_SELECTION_EVENT, {
      detail,
    })
  );
}

interface SelectionActionsProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onExplain?: (payload: SelectionActionPayload) => void;
  onTakeNote?: (payload: SelectionActionPayload) => void;
  getMetadata?: (range: Range) => NoteMetadata | undefined | null;
  disabled?: boolean;
  source?: SelectionActionPayload["source"];
}

interface SelectionState {
  text: string;
  rect: DOMRect;
  metadata?: NoteMetadata | null;
}

export function SelectionActions({
  containerRef,
  onExplain,
  onTakeNote,
  getMetadata,
  disabled,
  source,
}: SelectionActionsProps) {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const latestSelectionRef = useRef<SelectionState | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    latestSelectionRef.current = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      sel.removeAllRanges();
    }
  }, []);

  const handleSelectionChange = useCallback(() => {
    if (disabled) {
      setSelection(null);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setSelection(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement ?? null;

    if (!commonAncestor || (!container.contains(commonAncestor) && commonAncestor !== container)) {
      setSelection(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelection(null);
      return;
    }

    const metadata = getMetadata ? getMetadata(range) : undefined;

    const nextState: SelectionState = {
      text,
      rect,
      metadata: metadata ?? undefined,
    };

    latestSelectionRef.current = nextState;
    setSelection(nextState);
  }, [containerRef, getMetadata, disabled]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    const handleMouseUp = () => {
      requestAnimationFrame(handleSelectionChange);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift" || event.key === "Meta" || event.key === "Control") return;
      requestAnimationFrame(handleSelectionChange);
    };

    const handleScroll = () => {
      if (selection) {
        clearSelection();
      }
    };

    const handleMouseDownClear = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-actions]')) {
        return;
      }
      clearSelection();
    };

    const handleTouchStartClear = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-actions]')) {
        return;
      }
      clearSelection();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-actions]')) {
        return;
      }
      requestAnimationFrame(handleSelectionChange);
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchstart", handleTouchStartClear, { passive: true });
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("mousedown", handleMouseDownClear);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchstart", handleTouchStartClear);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("mousedown", handleMouseDownClear);
    };
  }, [handleSelectionChange, selection, clearSelection, disabled]);

  useEffect(() => {
    if (disabled) {
      clearSelection();
    }
  }, [disabled, clearSelection]);

  // Clear browser's visual selection highlight on mobile (prevent tap conflicts)
  React.useEffect(() => {
    if (selection && typeof window !== 'undefined' && window.innerWidth < 768) {
      const browserSelection = window.getSelection();
      if (browserSelection && browserSelection.rangeCount > 0) {
        browserSelection.removeAllRanges();
      }
    }
  }, [selection]);

  if (!selection || disabled) {
    return null;
  }

  const handleAction = async (action: "explain" | "note") => {
    if (!latestSelectionRef.current) return;
    const { text, metadata: selectionMetadata } = latestSelectionRef.current;
    const metadata: NoteMetadata = selectionMetadata
      ? { ...selectionMetadata, selectedText: text }
      : { selectedText: text };
    const payload: SelectionActionPayload = {
      text,
      metadata,
      source,
    };

    try {
      setIsProcessing(true);
      if (action === "explain" && onExplain) {
        await onExplain(payload);
      } else if (action === "note" && onTakeNote) {
        await onTakeNote(payload);
      }
    } finally {
      setIsProcessing(false);
      clearSelection();
    }
  };

  // Detect mobile
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

  if (isMobile) {
    // MOBILE: Render modal popup
    return createPortal(
      <div 
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={(e) => {
          // Click outside modal = close
          if (e.target === e.currentTarget) {
            clearSelection();
          }
        }}
        onTouchStart={(e) => {
          // Prevent touch events from bubbling
          if (e.target === e.currentTarget) {
            e.preventDefault();
          }
        }}
      >
        <Card
          data-selection-actions="true"
          className="relative mx-4 w-full max-w-sm bg-white shadow-2xl rounded-2xl p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => {
            e.stopPropagation();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
          }}
        >
          {/* Close button */}
          <button
            onClick={clearSelection}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          {/* Selected text preview */}
          <div className="mb-5 pr-10">
            <p className="text-xs font-medium text-gray-500 mb-2">Selected text:</p>
            <p className="text-sm text-gray-900 line-clamp-3 leading-relaxed">
              &ldquo;{selection.text.length > 100 ? selection.text.substring(0, 100) + '...' : selection.text}&rdquo;
            </p>
          </div>

          {/* Action buttons - Single row */}
          <div className="flex gap-3">
            {onExplain && (
              <Button
                size="lg"
                className="flex-1 h-12 text-base font-medium"
                disabled={isProcessing}
                onClick={() => handleAction("explain")}
              >
                {isProcessing ? "Processing..." : "Explain"}
              </Button>
            )}
            {onTakeNote && (
              <Button
                size="lg"
                variant="outline"
                className="flex-1 h-12 text-base font-medium"
                disabled={isProcessing}
                onClick={() => handleAction("note")}
              >
                Take Notes
              </Button>
            )}
          </div>
        </Card>
      </div>,
      document.body
    );
  }

  // DESKTOP: Floating button above selection
  const { rect } = selection;
  const buttonHeight = 48;
  const padding = 12;

  const viewportHeight = typeof window !== 'undefined' 
    ? (window.visualViewport?.height || window.innerHeight)
    : 0;
  const viewportWidth = typeof window !== 'undefined'
    ? (window.visualViewport?.width || window.innerWidth)
    : 0;

  const safeZone = { top: 60, bottom: 20 };

  // Desktop: Smart positioning (prefer above, fallback below)
  const posAbove = rect.top + window.scrollY - buttonHeight - padding;
  const posBelow = rect.bottom + window.scrollY + padding;
  
  const isAboveVisible = rect.top >= (safeZone.top + buttonHeight + padding);
  const isBelowVisible = (rect.bottom + buttonHeight + padding) <= (viewportHeight - safeZone.bottom);
  
  let top: number;
  if (isAboveVisible) {
    top = posAbove;
  } else if (isBelowVisible) {
    top = posBelow;
  } else {
    const minTop = window.scrollY + safeZone.top;
    top = Math.max(posAbove, minTop);
  }

  // Horizontal positioning
  const left = rect.left + window.scrollX + rect.width / 2;
  const buttonWidth = 200;
  const minLeft = window.scrollX + buttonWidth / 2 + padding;
  const maxLeft = window.scrollX + viewportWidth - buttonWidth / 2 - padding;
  const clampedLeft = Math.max(minLeft, Math.min(left, maxLeft));

  return createPortal(
    <Card
      data-selection-actions="true"
      className="fixed z-[9999] flex flex-row items-center gap-1 rounded-xl border border-border/40 bg-primary/5 backdrop-blur-md shadow-lg px-3 py-1.5 transition-opacity animate-in fade-in"
      style={{
        top: top,
        left: clampedLeft,
        transform: "translateX(-50%)",
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {onExplain && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-sm font-normal rounded-lg transition-all duration-200 hover:bg-primary/10 hover:scale-105 hover:text-foreground"
          disabled={isProcessing}
          onClick={() => handleAction("explain")}
        >
          Explain
        </Button>
      )}
      {onExplain && onTakeNote && (
        <div className="h-6 w-px bg-border/60" />
      )}
      {onTakeNote && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-sm font-normal rounded-lg transition-all duration-200 hover:bg-primary/10 hover:scale-105 hover:text-foreground"
          disabled={isProcessing}
          onClick={() => handleAction("note")}
        >
          Take Notes
        </Button>
      )}
    </Card>,
    document.body
  );
}

