"use client";

import { Suspense, useCallback, useEffect } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { UrlInput } from "@/components/url-input";
import { Card } from "@/components/ui/card";
import { extractVideoId } from "@/lib/utils";
import { toast } from "sonner";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!searchParams) return;

    const videoIdParam = searchParams.get("v");
    if (!videoIdParam) return;

    const params = new URLSearchParams();
    const cachedParam = searchParams.get("cached");
    const urlParam = searchParams.get("url");

    if (cachedParam === "true") {
      params.set("cached", "true");
    }

    if (urlParam) {
      params.set("url", urlParam);
    }

    router.replace(
      `/analyze/${videoIdParam}${params.toString() ? `?${params.toString()}` : ""}`,
      { scroll: false }
    );
  }, [router, searchParams]);

  const handleSubmit = useCallback(
    (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) {
        toast.error("Please enter a valid YouTube URL");
        return;
      }

      const params = new URLSearchParams();
      params.set("url", url);

      router.push(`/analyze/${videoId}?${params.toString()}`);
    },
    [router]
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="mx-auto flex w-full max-w-[660px] -translate-y-[5vh] transform flex-col items-center gap-9 px-6 py-16 text-center sm:py-24">
        <header className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/Video_Play.svg"
              alt="Video play icon"
              width={30}
              height={30}
              className="h-[30px] w-[30px]"
            />
            <h1 className="text-[21px] font-bold tracking-tight text-[#787878]">TLDW</h1>
          </div>
          <p className="text-[14px] leading-[15px] text-[#787878]">
            Too Long; Didn't Watch - Learn from long videos 10x faster
          </p>
        </header>

        <div className="flex w-full flex-col items-center gap-9">
          <UrlInput onSubmit={handleSubmit} />

          <Card className="relative flex w-[425px] max-w-full flex-col gap-2.5 overflow-hidden rounded-[22px] border border-[#f0f1f1] bg-white p-6 text-left shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)]">
            <div className="relative z-10 flex flex-col gap-2.5">
              <h3 className="text-[14px] font-medium leading-[15px] text-[#5c5c5c]">
                Jump to top insights immediately
              </h3>
              <p className="max-w-[60%] text-[14px] leading-[1.5] text-[#8d8d8d]">
                Paste a link, and we'll generate highlight reels for you. Consume a 1-hour video in 5 minutes.
              </p>
            </div>
            <div className="pointer-events-none absolute right-[10px] top-[-00px] h-[110px] w-[110px]">
              <div className="absolute inset-0 overflow-hidden rounded-full opacity-100 [mask-image:radial-gradient(circle,black_30%,transparent_65%)]">
                <Image
                  src="/gradient_person.jpg"
                  alt="Gradient silhouette illustration"
                  fill
                  sizes="100px"
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
