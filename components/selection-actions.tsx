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
  const container = containerRef.current;

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

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("touchend", handleMouseUp);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("mousedown", clearSelection);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("touchend", handleMouseUp);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("mousedown", clearSelection);
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
  
  // Smart positioning: place below if not enough space above
  const viewportTop = rect.top;
  const buttonHeight = 48;
  const padding = 12;
  const shouldPlaceBelow = viewportTop < (buttonHeight + padding);

  const top = shouldPlaceBelow
    ? rect.bottom + window.scrollY + padding  // Below selection
    : rect.top + window.scrollY - buttonHeight; // Above selection

  const left = rect.left + window.scrollX + rect.width / 2;

  return createPortal(
    <Card
      className={cn(
        "fixed z-[9999] flex flex-row items-center gap-1 rounded-xl border border-border/40 bg-primary/5 backdrop-blur-md shadow-lg",
        "transition-opacity animate-in fade-in",
        "px-3 py-1.5",
      )}
      style={{
        top: Math.max(top, padding),
        left,
        transform: "translateX(-50%)",
      }}
      onMouseDown={(event) => event.stopPropagation()}
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

