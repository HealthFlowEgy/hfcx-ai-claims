import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

// Allow up to 5 minutes for AI inference (self-hosted Ollama models)
export const maxDuration = 300;

/**
 * BFF Proxy — forwards frontend API requests to the backend with the
 * HttpOnly session token injected as a Bearer token.
 *
 * Route: /api/proxy/<backend-path>
 * Example: /api/proxy/internal/ai/bff/provider/summary
 *          → https://api.claim.healthflow.tech/internal/ai/bff/provider/summary
 *
 * If the access token (hcx_session) has expired but a refresh token
 * (hcx_refresh) is available, the proxy will silently refresh the
 * access token before forwarding the request.
 */

const API_BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'https://api.claim.healthflow.tech';

async function refreshAccessToken(): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('hcx_refresh')?.value;
  if (!refreshToken) return null;

  const realm = process.env.KEYCLOAK_REALM ?? 'hcx';
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'hfcx-portal';
  const keycloakInternal =
    process.env.KEYCLOAK_INTERNAL_URL ??
    'http://keycloak.hcx-ai.svc.cluster.local:8080';

  try {
    const tokenUrl = `${keycloakInternal}/realms/${realm}/protocol/openid-connect/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });

    if (!resp.ok) return null;

    const tokens = await resp.json();
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresIn: tokens.expires_in ?? 300,
    };
  } catch {
    return null;
  }
}

async function proxyRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const backendPath = '/' + path.join('/');
  const url = new URL(backendPath, API_BASE);

  // Forward query parameters
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  // Read the HttpOnly session cookie
  const cookieStore = await cookies();
  let token = cookieStore.get('hcx_session')?.value;
  let refreshedTokens: Awaited<ReturnType<typeof refreshAccessToken>> = null;

  // If no access token, try to refresh
  if (!token) {
    refreshedTokens = await refreshAccessToken();
    if (refreshedTokens) {
      token = refreshedTokens.accessToken;
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: 'not_authenticated', message: 'Session expired. Please log in again.' },
      { status: 403 },
    );
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Forward HCX headers
  for (const headerName of [
    'X-HCX-Correlation-ID',
    'X-HCX-Sender-Code',
    'X-HCX-Recipient-Code',
    'X-HCX-Workflow-ID',
    'X-HCX-API-Call-ID',
  ]) {
    const val = req.headers.get(headerName);
    if (val) headers[headerName] = val;
  }

  // Forward Accept-Language
  const lang = req.headers.get('Accept-Language');
  if (lang) headers['Accept-Language'] = lang;

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };

    // Forward body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOpts.body = await req.text();
    }

    // 5-minute timeout for AI inference calls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    fetchOpts.signal = controller.signal;

    const response = await fetch(url.toString(), fetchOpts);
    clearTimeout(timeoutId);
    const responseBody = await response.text();

    const proxyResponse = new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') ?? 'application/json',
      },
    });

    // If we refreshed the token, set the new cookies on the response
    if (refreshedTokens) {
      proxyResponse.cookies.set('hcx_session', refreshedTokens.accessToken, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: refreshedTokens.expiresIn,
      });
      proxyResponse.cookies.set('hcx_refresh', refreshedTokens.refreshToken, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 3600,
      });
    }

    return proxyResponse;
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
