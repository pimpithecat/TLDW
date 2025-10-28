export function VideoSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 animate-pulse">
      {/* Left Column - Video placeholder */}
      <div className="lg:col-span-2">
        <div className="sticky top-[6.5rem] space-y-3.5">
          <div className="bg-gray-200 dark:bg-gray-700 aspect-video rounded-lg" />

          {/* Theme selector skeleton */}
          <div className="flex justify-center">
            <div className="h-10 w-64 bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>

          {/* Topic cards skeleton */}
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right Column - Tabs skeleton */}
      <div className="lg:col-span-1">
        <div className="sticky top-[6.5rem]">
          <div className="flex flex-col overflow-hidden bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700">
            {/* Tab headers */}
            <div className="flex items-center gap-2 p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex-1 h-9 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
              <div className="flex-1 h-9 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
              <div className="flex-1 h-9 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
            </div>

            {/* Content area - simulate transcript lines */}
            <div className="overflow-hidden p-4 space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}