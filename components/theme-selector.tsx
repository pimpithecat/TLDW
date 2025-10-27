"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowUp, ChevronLeft, ChevronRight, Plus, X, Sparkles } from "lucide-react";

interface ThemeSelectorProps {
  themes: string[];
  selectedTheme: string | null;
  onSelect: (theme: string | null) => void;
  onDelete?: (theme: string) => void;
  onSuggestThemes?: () => void;
  isLoading?: boolean;
  isSuggesting?: boolean;
  error?: string | null;
  placeholderThemes?: Set<string>; // Themes that don't have generated topics yet
}

export function ThemeSelector({
  themes,
  selectedTheme,
  onSelect,
  onDelete,
  onSuggestThemes,
  isLoading = false,
  isSuggesting = false,
  error = null,
  placeholderThemes = new Set(),
}: ThemeSelectorProps) {
  const [customThemes, setCustomThemes] = useState<string[]>([]);
  // Display all themes from props
  const displayThemes = useMemo(() => {
    const allThemes = [...themes, ...customThemes.filter((theme) => !themes.includes(theme))];
    return allThemes;
  }, [themes, customThemes]);
  const hasThemes = displayThemes.length > 0;
  const isOverallSelected = selectedTheme === null;
  const [customThemeInput, setCustomThemeInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  const trimmedValue = customThemeInput.trim();
  const isSubmitDisabled = trimmedValue.length === 0 || isLoading;

  const isCustomThemeSelected = useMemo(() => {
    return selectedTheme !== null && customThemes.includes(selectedTheme);
  }, [customThemes, selectedTheme]);

  useEffect(() => {
    if (selectedTheme && !themes.includes(selectedTheme)) {
      setCustomThemes((prev) => {
        if (prev.includes(selectedTheme)) {
          return prev;
        }
        return [...prev, selectedTheme];
      });
    }
  }, [themes, selectedTheme]);

  const buttonClasses = (isActive: boolean, forceInactive = false) =>
    cn(
      "rounded-full px-3 py-1 text-sm transition-colors",
      isActive && !forceInactive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
    );

  const openCustomInput = () => {
    if (isLoading) return;
    setShowCustomInput(true);
    setValidationError(null);
    if (isCustomThemeSelected && selectedTheme) {
      setCustomThemeInput(selectedTheme);
    } else {
      setCustomThemeInput("");
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const closeCustomInput = () => {
    setShowCustomInput(false);
    setCustomThemeInput("");
    setValidationError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!trimmedValue) {
      setValidationError("Enter a theme to focus on.");
      return;
    }

    if (trimmedValue.length > 60) {
      setValidationError("Keep themes under 60 characters.");
      return;
    }

    setCustomThemes((prev) => {
      if (themes.includes(trimmedValue) || prev.includes(trimmedValue)) {
        return prev;
      }
      return [...prev, trimmedValue];
    });
    setShowCustomInput(false);
    setCustomThemeInput("");
    setValidationError(null);
    onSelect(trimmedValue);
  };

  // Check if scroll is needed
  const checkScrollNeeded = () => {
    if (scrollContainerRef.current) {
      const { scrollWidth, clientWidth, scrollLeft } = scrollContainerRef.current;
      const canScrollLeft = scrollLeft > 0;
      const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1; // -1 for rounding
      
      setShowLeftScroll(canScrollLeft);
      setShowRightScroll(canScrollRight);
    }
  };

  // Scroll handlers
  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: -200,
        behavior: "smooth",
      });
      // Recheck after scroll completes
      setTimeout(checkScrollNeeded, 300);
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: 200,
        behavior: "smooth",
      });
      // Recheck after scroll completes
      setTimeout(checkScrollNeeded, 300);
    }
  };

  // Check scroll on mount and when themes change
  useEffect(() => {
    checkScrollNeeded();
    window.addEventListener("resize", checkScrollNeeded);
    
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", checkScrollNeeded);
    }
    
    return () => {
      window.removeEventListener("resize", checkScrollNeeded);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", checkScrollNeeded);
      }
    };
  }, [displayThemes, isCustomThemeSelected, selectedTheme, showCustomInput]);

  return (
    <div className="flex w-full flex-col items-stretch gap-3">
      <div className="relative flex items-center gap-2 pe-[72px]">
        {/* Your Topic button - invisible when custom input is shown */}
        <Button
          type="button"
          size="sm"
          className={cn(
            buttonClasses(showCustomInput || isCustomThemeSelected),
            "flex items-center gap-1.5 transition-all duration-200 flex-shrink-0",
            showCustomInput && "opacity-0 pointer-events-none"
          )}
          onClick={openCustomInput}
          disabled={isLoading}
        >
          <Plus className="h-3.5 w-3.5" />
          Your Topic
        </Button>

        {/* Scrollable container for theme buttons - always rendered */}
        <div
          ref={scrollContainerRef}
          className={cn(
            "flex items-center gap-2 overflow-x-auto overflow-y-visible scrollbar-hide flex-1 transition-all duration-200 bg-transparent py-6 my-[-24px]",
            showCustomInput && "blur-[2px] opacity-50 pointer-events-none"
          )}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <Button
            type="button"
            size="sm"
            className={cn(buttonClasses(isOverallSelected, showCustomInput), "transition-all duration-200 flex-shrink-0")}
            onClick={() => onSelect(null)}
            tabIndex={showCustomInput ? -1 : 0}
          >
            Overall highlights
          </Button>
          {hasThemes && displayThemes.map((theme) => {
            const isPlaceholder = placeholderThemes.has(theme);
            const isSelected = selectedTheme === theme;
            
            return (
              <div key={theme} className="relative flex-shrink-0 group">
                <Button
                  type="button"
                  size="sm"
                  className={cn(
                    "rounded-full px-3 py-1 text-sm transition-all duration-200 pr-8",
                    // Selected state (same for both)
                    isSelected && !showCustomInput
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "",
                    // Not selected - different backgrounds
                    !isSelected && !isPlaceholder && "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    !isSelected && isPlaceholder && "bg-blue-50 text-muted-foreground hover:text-foreground hover:bg-blue-100",
                    showCustomInput && "blur-[2px] opacity-50"
                  )}
                  onClick={() => onSelect(selectedTheme === theme ? null : theme)}
                  tabIndex={showCustomInput ? -1 : 0}
                  title={isPlaceholder ? "Click to generate topics" : undefined}
                >
                  {theme}
                </Button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(theme);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted/80 hover:bg-destructive hover:text-destructive-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center"
                    aria-label={`Delete ${theme}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        
        {/* Combined scroll button - absolutely positioned on right edge */}
        {(showLeftScroll || showRightScroll) && !showCustomInput && (
          <div className="absolute right-0 top-0 flex items-center z-[5]">
            {/* Gradient fade overlay */}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent via-background/50 to-background pointer-events-none" />
            
            {/* Combined scroll button */}
            <div className="relative flex items-center justify-center flex-shrink-0 backdrop-blur-sm bg-white rounded-full p-0.5 shadow-[-1px_4px_21.8px_0_rgba(0,0,0,0.25)]">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleScrollLeft}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleScrollRight}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Overlay for custom input - absolute positioned */}
        {showCustomInput && (
          <div className="absolute left-0 top-0 z-10">
            <div className="flex items-center gap-2 rounded-full bg-transparent">
              {/* X button - external on the left */}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-muted text-muted-foreground transition-all duration-200"
                onClick={closeCustomInput}
              >
                <X className="h-4 w-4" />
              </Button>
              
              {/* Form with expanded textbox and inline buttons */}
              <form className="relative flex items-center gap-2" onSubmit={handleSubmit}>
                <Input
                  ref={inputRef}
                  value={customThemeInput}
                  onChange={(event) => {
                    if (validationError) {
                      setValidationError(null);
                    }
                    setCustomThemeInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeCustomInput();
                    }
                  }}
                  placeholder="Input your topic"
                  disabled={isLoading || isSuggesting}
                  className="h-8 w-[240px] rounded-full bg-muted border-0 px-3 pr-10 text-sm transition-all duration-300 ease-in-out"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  disabled={isSubmitDisabled}
                  className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                {onSuggestThemes && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      closeCustomInput();
                      onSuggestThemes();
                    }}
                    disabled={isLoading || isSuggesting}
                    className="h-8 w-8 rounded-full"
                    title="Suggest topics from AI"
                  >
                    <Sparkles className={cn("h-4 w-4", isSuggesting && "animate-pulse")} />
                  </Button>
                )}
              </form>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
      {validationError && !error && (
        <p className="text-xs text-destructive text-center">{validationError}</p>
      )}
    </div>
  );
}
