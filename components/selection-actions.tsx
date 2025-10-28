"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NoteMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";

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

  const { rect } = selection;
  const buttonHeight = 48;
  const padding = 12;

  // Detect mobile
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

  // Get viewport dimensions (accounting for mobile browser bars)
  const viewportHeight = typeof window !== 'undefined' 
    ? (window.visualViewport?.height || window.innerHeight)
    : 0;
  const viewportWidth = typeof window !== 'undefined'
    ? (window.visualViewport?.width || window.innerWidth)
    : 0;

  // Safe zones for mobile browser UI
  const safeZone = {
    top: 60,
    bottom: isMobile ? 100 : 20
  };

  let top: number;

  if (isMobile) {
    // MOBILE: ALWAYS above selection
    const desiredTop = rect.top + window.scrollY - buttonHeight - padding;
    const minTop = window.scrollY + safeZone.top;
    
    // Clamp to safe zone top (prevent going off viewport top)
    top = Math.max(desiredTop, minTop);
    
  } else {
    // DESKTOP: Smart positioning (prefer above, fallback below)
    const posAbove = rect.top + window.scrollY - buttonHeight - padding;
    const posBelow = rect.bottom + window.scrollY + padding;
    
    const isAboveVisible = rect.top >= (safeZone.top + buttonHeight + padding);
    const isBelowVisible = (rect.bottom + buttonHeight + padding) <= (viewportHeight - safeZone.bottom);
    
    if (isAboveVisible) {
      top = posAbove;
    } else if (isBelowVisible) {
      top = posBelow;
    } else {
      // Fallback: use above with clamp
      const minTop = window.scrollY + safeZone.top;
      top = Math.max(posAbove, minTop);
    }
  }

  // Horizontal positioning (same for both mobile and desktop)
  const left = rect.left + window.scrollX + rect.width / 2;

  // Ensure button doesn't go off screen horizontally
  const buttonWidth = 200;
  const minLeft = window.scrollX + buttonWidth / 2 + padding;
  const maxLeft = window.scrollX + viewportWidth - buttonWidth / 2 - padding;
  const clampedLeft = Math.max(minLeft, Math.min(left, maxLeft));

  return createPortal(
    <Card
      data-selection-actions="true"
      className={cn(
        "fixed z-[9999] flex flex-row items-center gap-1 rounded-xl backdrop-blur-md shadow-lg",
        "transition-opacity animate-in fade-in",
        isMobile 
          ? "border border-border/60 bg-white/98 px-3 py-2 shadow-xl"
          : "border border-border/40 bg-primary/5 px-3 py-1.5"
      )}
      style={{
        top: top,
        left: clampedLeft,
        transform: "translateX(-50%)",
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {onExplain && (
        <Button
          variant="ghost"
          size={isMobile ? "default" : "sm"}
          className={cn(
            "font-normal rounded-lg transition-all duration-200",
            isMobile 
              ? "h-11 px-4 text-base min-w-[120px]"
              : "h-7 px-2.5 text-sm",
            "hover:bg-primary/10 hover:scale-105 hover:text-foreground"
          )}
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
          size={isMobile ? "default" : "sm"}
          className={cn(
            "font-normal rounded-lg transition-all duration-200",
            isMobile 
              ? "h-11 px-4 text-base min-w-[120px]"
              : "h-7 px-2.5 text-sm",
            "hover:bg-primary/10 hover:scale-105 hover:text-foreground"
          )}
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

