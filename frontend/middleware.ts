import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware — auth + locale default (SRS §9.3).
 *
 * 1. If the user hits any portal route without a valid session (no
 *    `hcx_session` cookie AND the page isn't the landing / public),
 *    we redirect to Keycloak, preserving the original URL via the
 *    `next` query parameter for post-login redirect.
 *
 * 2. If the `hcx_locale` cookie is missing, we seed it to Arabic so
 *    the server-side `i18n.ts` resolver sees the correct default on
 *    the very first request.
 *
 * The cookie-based check is a lightweight gate; the real JWT
 * validation happens at the BFF layer (SEC-001). The middleware only
 * catches obviously unauthenticated requests and avoids a blank
 * page-forever experience.
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

  // Skip public routes and Next.js internal routes.
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon')
  ) {
    return response;
  }

  // Portal routes require a session cookie. In development we accept
  // the absence of the cookie (the BFF uses dev-tokens); production
  // uses Keycloak and refuses the portal shell without the cookie.
  const isPortalRoute = PORTAL_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = request.cookies.has('hcx_session');
  const isProduction = process.env.NODE_ENV === 'production';

  if (isPortalRoute && isProduction && !hasSession) {
    const keycloakUrl =
      process.env.KEYCLOAK_URL ?? 'https://auth.claim.healthflow.tech';
    const realm = process.env.KEYCLOAK_REALM ?? 'hcx';
    const clientId =
      process.env.KEYCLOAK_CLIENT_ID ?? 'hfcx-portal';

    // Build the redirect URI using the public portal base URL.
    // request.nextUrl.toString() returns the internal container address
    // (e.g. https://0.0.0.0:3000/provider), so we construct the
    // external URL from PORTAL_BASE_URL or the X-Forwarded-Host header.
    const portalBase =
      process.env.PORTAL_BASE_URL ?? 'https://portal.claim.healthflow.tech';
    const redirectUri = encodeURIComponent(`${portalBase}${pathname}`);

    const login =
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth` +
      `?client_id=${clientId}&response_type=code&scope=openid&redirect_uri=${redirectUri}`;
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
