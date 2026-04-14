import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware — auth + locale default (SRS §9.3).
 *
 * 1. If the user hits any portal route without a valid session (no
 *    `hcx_session` cookie AND no `hcx_refresh` cookie), we redirect
 *    to Keycloak, preserving the original URL via the `state`
 *    parameter for post-login redirect.
 *
 * 2. If the `hcx_locale` cookie is missing, we seed it to Arabic so
 *    the server-side `i18n.ts` resolver sees the correct default on
 *    the very first request.
 *
 * The cookie-based check is a lightweight gate; the real JWT
 * validation happens at the BFF layer (SEC-001). The middleware only
 * catches obviously unauthenticated requests and avoids a blank
 * page-forever experience.
 *
 * When the access token (hcx_session) expires but the refresh token
 * (hcx_refresh) is still valid, the middleware lets the request
 * through. The BFF proxy (/api/proxy) will silently refresh the
 * access token using the refresh token.
 */

const PORTAL_PREFIXES = ['/provider', '/payer', '/siu', '/regulatory'];
const PUBLIC_PATHS = ['/', '/access-denied'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Initialize the locale cookie on the first request so the server
  // resolver picks Arabic RTL even before the user touches the toggle.
  const response = NextResponse.next();
  if (!request.cookies.has('hcx_locale')) {
    response.cookies.set('hcx_locale', 'ar', {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    });
  }

  // Skip public routes, Next.js internal routes, and API routes.
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon')
  ) {
    return response;
  }

  // Portal routes require a session cookie. If the access token has
  // expired but the refresh token is still present, we let the request
  // through — the BFF proxy will silently refresh the access token.
  const isPortalRoute = PORTAL_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = request.cookies.has('hcx_session');
  const hasRefresh = request.cookies.has('hcx_refresh');
  const isProduction = process.env.NODE_ENV === 'production';

  if (isPortalRoute && isProduction && !hasSession && !hasRefresh) {
    const keycloakUrl =
      process.env.KEYCLOAK_URL ?? 'https://auth.claim.healthflow.tech';
    const realm = process.env.KEYCLOAK_REALM ?? 'hcx';
    const clientId =
      process.env.KEYCLOAK_CLIENT_ID ?? 'hfcx-portal';
    const portalBase =
      process.env.PORTAL_BASE_URL ?? 'https://portal.claim.healthflow.tech';

    // The redirect_uri points to our callback handler which exchanges
    // the auth code for tokens and sets the session cookie.
    const redirectUri = encodeURIComponent(`${portalBase}/api/auth/callback`);
    // The state parameter preserves the originally requested path.
    const state = encodeURIComponent(pathname);

    const login =
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth` +
      `?client_id=${clientId}&response_type=code&scope=openid` +
      `&redirect_uri=${redirectUri}&state=${state}`;
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip _next/static, _next/image, favicon, and public files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
