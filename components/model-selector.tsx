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

export type GeminiModel = 'gemini-2.5-flash' | 'gemini-2.5-flash-lite' | 'gemini-2.5-pro' | 'gemini-2.0-flash';

interface ModelInfo {
  id: GeminiModel;
  name: string;
  description: string;
  strengths: string[];
}

const modelInfo: ModelInfo[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast performance with thinking capabilities',
    strengths: ['Balanced speed and quality', 'Cost-efficient', 'Best for everyday tasks']
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Optimized for high throughput',
    strengths: ['Fastest response time', 'Most cost-efficient', 'High throughput']
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'State-of-the-art reasoning model',
    strengths: ['Maximum accuracy', 'Complex reasoning', 'Best for challenging tasks']
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Previous generation with proven reliability',
    strengths: ['Stable performance', 'Lower output token limit', 'Well-tested']
  }
];

interface ModelSelectorProps {
  value: GeminiModel;
  onChange: (value: GeminiModel) => void;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const selectedModel = modelInfo.find(m => m.id === value);

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          {modelInfo.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {selectedModel && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-2">
                <p className="font-semibold">{selectedModel.name}</p>
                <p className="text-sm">{selectedModel.description}</p>
                <ul className="text-sm space-y-1">
                  {selectedModel.strengths.map((strength, idx) => (
                    <li key={idx} className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}