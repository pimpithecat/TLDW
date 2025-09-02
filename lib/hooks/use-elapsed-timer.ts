import { useEffect, useState } from 'react';

/**
 * Custom hook for tracking elapsed time since a given start time
 * @param startTime - The timestamp to start counting from (or null to stop)
 * @returns The elapsed time in seconds
 */
export function useElapsedTimer(startTime: number | null): number {
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  useEffect(() => {
    if (startTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setElapsedTime(0);
    }
  }, [startTime]);

  return elapsedTime;
}