'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface PlayAllContextType {
  isPlayingAll: boolean;
  playAllIndex: number;
  setIsPlayingAll: (value: boolean) => void;
  setPlayAllIndex: (value: number) => void;
  resetPlayAll: () => void;
  startPlayAll: () => void;
  stopPlayAll: () => void;
  nextInPlayAll: () => void;
}

const PlayAllContext = createContext<PlayAllContextType | undefined>(undefined);

export function PlayAllProvider({ children }: { children: ReactNode }) {
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);

  const resetPlayAll = () => {
    setIsPlayingAll(false);
    setPlayAllIndex(0);
  };

  const startPlayAll = () => {
    setIsPlayingAll(true);
    setPlayAllIndex(0);
  };

  const stopPlayAll = () => {
    setIsPlayingAll(false);
  };

  const nextInPlayAll = () => {
    setPlayAllIndex(prev => prev + 1);
  };

  return (
    <PlayAllContext.Provider
      value={{
        isPlayingAll,
        playAllIndex,
        setIsPlayingAll,
        setPlayAllIndex,
        resetPlayAll,
        startPlayAll,
        stopPlayAll,
        nextInPlayAll,
      }}
    >
      {children}
    </PlayAllContext.Provider>
  );
}

export function usePlayAll() {
  const context = useContext(PlayAllContext);
  if (context === undefined) {
    throw new Error('usePlayAll must be used within a PlayAllProvider');
  }
  return context;
}