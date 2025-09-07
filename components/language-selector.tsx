'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Language, LANGUAGE_INFO, isRTLLanguage } from "@/lib/language-utils";

// Re-export Language type for backward compatibility
export type { Language } from "@/lib/language-utils";

interface LanguageSelectorProps {
  value: Language;
  onChange: (value: Language) => void;
  disabled?: boolean;
}

export function LanguageSelector({ value, onChange, disabled }: LanguageSelectorProps) {
  const selectedLanguage = LANGUAGE_INFO.find(l => l.id === value);
  const isRTL = isRTLLanguage(value);

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-[200px]" aria-label="Select summary language">
          <SelectValue placeholder="Select a language" />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGE_INFO.map((lang) => (
            <SelectItem key={lang.id} value={lang.id}>
              <span className="flex items-center justify-between w-full">
                <span>{lang.name}</span>
                {lang.nativeName !== lang.name && (
                  <span className="text-muted-foreground ml-2">{lang.nativeName}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-2">
              <p className="font-semibold">Summary Language</p>
              <p className="text-sm">
                The video summary will be generated in {selectedLanguage?.nativeName || value}.
              </p>
              {isRTL && (
                <p className="text-sm text-muted-foreground">
                  This language uses right-to-left text direction.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Note: The original transcript language detection and translation quality may vary 
                depending on the source video's audio clarity and the target language.
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}