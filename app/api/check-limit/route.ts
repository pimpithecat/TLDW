import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Authenticated users have no limits
      return NextResponse.json({
        canGenerate: true,
        isAuthenticated: true,
        generationsUsed: 0,
        limit: null
      });
    }

    // For anonymous users, check localStorage on client side
    // This endpoint just returns auth status
    return NextResponse.json({
      canGenerate: null, // Will be determined on client side
      isAuthenticated: false,
      message: 'Check performed on client side for anonymous users'
    });

  } catch (error) {
    console.error('Error checking generation limit:', error);
    return NextResponse.json(
      { error: 'Failed to check generation limit' },
      { status: 500 }
    );
  }
}