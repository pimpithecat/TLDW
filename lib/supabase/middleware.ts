import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    const { error } = await supabase.auth.getUser()

    if (error) {
      console.warn('Auth token refresh failed:', error.message)

      if (error.message?.includes('refresh_token_not_found') ||
          error.message?.includes('Invalid Refresh Token')) {
        const authCookies = request.cookies.getAll().filter(
          cookie => cookie.name.startsWith('sb-') &&
                   (cookie.name.includes('auth-token') || cookie.name.includes('refresh-token'))
        )

        authCookies.forEach(cookie => {
          supabaseResponse.cookies.delete(cookie.name)
        })

        console.log('Cleared invalid auth cookies')
      }
    }
  } catch (error) {
    console.error('Unexpected error in auth middleware:', error)
  }

  return supabaseResponse
}