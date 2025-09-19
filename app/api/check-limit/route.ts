import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';

export async function GET() {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();

    // Use appropriate rate limit config based on auth status
    const rateLimitConfig = user ? RATE_LIMITS.AUTH_GENERATION : RATE_LIMITS.ANON_GENERATION;

    // Check rate limit without consuming it (peek)
    const identifier = user ? `user:${user.id}` : undefined;
    const rateLimitKey = `video-analysis`;

    // Get current rate limit status without incrementing counter
    const now = Date.now();
    const windowStart = now - rateLimitConfig.windowMs;

    // Count recent requests
    const { data: recentRequests } = await supabase
      .from('rate_limits')
      .select('id')
      .eq('key', `ratelimit:${rateLimitKey}:${identifier || 'anon'}`)
      .gte('timestamp', new Date(windowStart).toISOString());

    const requestCount = recentRequests?.length || 0;
    const remaining = Math.max(0, rateLimitConfig.maxRequests - requestCount);
    const resetAt = new Date(now + rateLimitConfig.windowMs);

    return NextResponse.json({
      canGenerate: remaining > 0,
      isAuthenticated: !!user,
      remaining,
      limit: rateLimitConfig.maxRequests,
      resetAt: resetAt.toISOString(),
      windowMs: rateLimitConfig.windowMs
    });

  } catch (error) {
    // Log error details server-side only
    console.error('Error checking generation limit:', error);

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while checking limits' },
      { status: 500 }
    );
  }
}