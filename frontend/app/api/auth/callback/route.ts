import { NextRequest, NextResponse } from 'next/server';

/**
 * OAuth 2.0 Authorization Code callback handler.
 *
 * Keycloak redirects here after the user authenticates:
 *   GET /api/auth/callback?code=xxx&state=/provider
 *
 * We exchange the code for tokens, set the hcx_session cookie
 * (containing the access token), and redirect the user to the
 * originally requested portal page.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state') || '/';

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
  }

  const keycloakUrl =
    process.env.KEYCLOAK_URL ?? 'https://auth.claim.healthflow.tech';
  const realm = process.env.KEYCLOAK_REALM ?? 'hcx';
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'hfcx-portal';
  const portalBase =
    process.env.PORTAL_BASE_URL ?? 'https://portal.claim.healthflow.tech';
  const redirectUri = `${portalBase}/api/auth/callback`;

  try {
    // Exchange authorization code for tokens
    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorBody);
      return NextResponse.redirect(`${portalBase}/access-denied`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 300; // default 5 min

    // Set the session cookie with the access token
    const response = NextResponse.redirect(`${portalBase}${state}`);

    response.cookies.set('hcx_session', accessToken, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: expiresIn,
    });

    if (refreshToken) {
      response.cookies.set('hcx_refresh', refreshToken, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 1800, // 30 min SSO session idle
      });
    }

    return response;
  } catch (error) {
    console.error('Auth callback error:', error);
    return NextResponse.redirect(`${portalBase}/access-denied`);
  }
}
