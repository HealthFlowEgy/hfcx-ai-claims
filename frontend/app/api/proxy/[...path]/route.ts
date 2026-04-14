import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * BFF Proxy — forwards frontend API requests to the backend with the
 * HttpOnly session token injected as a Bearer token.
 *
 * Route: /api/proxy/<backend-path>
 * Example: /api/proxy/internal/ai/bff/provider/summary
 *          → https://api.claim.healthflow.tech/internal/ai/bff/provider/summary
 */

const API_BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'https://api.claim.healthflow.tech';

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendPath = '/' + path.join('/');
  const url = new URL(backendPath, API_BASE);

  // Forward query parameters
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  // Read the HttpOnly session cookie
  const cookieStore = await cookies();
  const token = cookieStore.get('hcx_session')?.value;

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Forward correlation ID if present
  const correlationId = req.headers.get('X-HCX-Correlation-ID');
  if (correlationId) {
    headers['X-HCX-Correlation-ID'] = correlationId;
  }

  // Forward Accept-Language
  const lang = req.headers.get('Accept-Language');
  if (lang) {
    headers['Accept-Language'] = lang;
  }

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };

    // Forward body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOpts.body = await req.text();
    }

    const response = await fetch(url.toString(), fetchOpts);
    const responseBody = await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'proxy_error', message: 'Failed to reach backend API' },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
