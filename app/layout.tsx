import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from '@/contexts/auth-context';
import { UserMenu } from '@/components/user-menu';
import { ToastProvider } from '@/components/toast-provider';
import { Footer } from '@/components/footer';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TLDW - Too Long; Didn't Watch",
  description: "Smart video navigation that transforms long YouTube videos into topic-driven learning experiences",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white text-[#787878]`}
      >
        <AuthProvider>
          <div className="min-h-screen flex flex-col">
            <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-end px-6 py-5">
              <UserMenu />
            </header>
            <main className="flex-1">
              {children}
            </main>
            <Footer />
          </div>
          <ToastProvider />
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
