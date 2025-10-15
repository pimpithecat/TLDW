"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Plus, X } from "lucide-react";

interface ThemeSelectorProps {
  themes: string[];
  selectedTheme: string | null;
  onSelect: (theme: string | null) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ThemeSelector({
  themes,
  selectedTheme,
  onSelect,
  isLoading = false,
  error = null,
}: ThemeSelectorProps) {
  const displayThemes = themes.slice(0, 3);
  const hasThemes = displayThemes.length > 0;
  const isOverallSelected = selectedTheme === null;
  const [customThemeInput, setCustomThemeInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedValue = customThemeInput.trim();
  const isSubmitDisabled = trimmedValue.length === 0 || isLoading;

  const isCustomSelection = useMemo(() => {
    return selectedTheme !== null && !displayThemes.includes(selectedTheme);
  }, [selectedTheme, displayThemes]);

  const buttonClasses = (isActive: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-sm transition-colors",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
    );

  const openCustomInput = () => {
    if (isLoading) return;
    setShowCustomInput(true);
    setValidationError(null);
    if (isCustomSelection && selectedTheme) {
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

    setShowCustomInput(false);
    setCustomThemeInput("");
    setValidationError(null);
    onSelect(trimmedValue);
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-3">
      <div className="flex flex-wrap items-center justify-start gap-2">
        {showCustomInput ? (
          <form className="flex items-center gap-2" onSubmit={handleSubmit}>
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
              placeholder="Focus on leadership, design..."
              disabled={isLoading}
              className="h-8 w-44 rounded-full px-3 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              className="rounded-full"
              disabled={isSubmitDisabled}
            >
              Apply
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full text-muted-foreground"
              onClick={closeCustomInput}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            className={cn(
              buttonClasses(showCustomInput || isCustomSelection),
              "flex items-center gap-1.5"
            )}
            onClick={openCustomInput}
            disabled={isLoading}
          >
            <Plus className="h-3.5 w-3.5" />
            Your Topic
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          className={buttonClasses(isOverallSelected)}
          onClick={() => onSelect(null)}
        >
          Overall highlights
        </Button>
        {hasThemes && displayThemes.map((theme) => (
          <Button
            key={theme}
            type="button"
            size="sm"
            className={buttonClasses(selectedTheme === theme)}
            onClick={() => onSelect(selectedTheme === theme ? null : theme)}
          >
            {theme}
          </Button>
        ))}
        {isCustomSelection && selectedTheme && !showCustomInput && (
          <Button
            type="button"
            size="sm"
            className={buttonClasses(true)}
            onClick={openCustomInput}
          >
            {selectedTheme}
          </Button>
        )}
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
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
