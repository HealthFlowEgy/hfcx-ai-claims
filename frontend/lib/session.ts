import type { SessionUser, UserRole } from './types';

/**
 * SRS §3.2 role-to-portal permission matrix.
 *
 * Returns the set of portals the given role can access. The portal
 * selector uses this to hide cards for unauthorized roles; the BFF
 * enforces the same matrix server-side (single source of truth lives
 * on the backend Keycloak mapper — this table is UX only).
 */
export const PORTAL_KEYS = ['provider', 'payer', 'siu', 'regulatory'] as const;
export type PortalKey = (typeof PORTAL_KEYS)[number];

const ROLE_PORTALS: Record<UserRole, Set<PortalKey>> = {
  provider_admin: new Set(['provider']),
  provider_billing: new Set(['provider']),
  payer_reviewer: new Set(['payer']),
  payer_admin: new Set(['payer', 'siu']),
  siu_investigator: new Set(['siu']),
  fra_supervisor: new Set(['regulatory']),
  hcx_admin: new Set(['provider', 'payer', 'siu', 'regulatory']),
};

export function portalsForRoles(roles: UserRole[]): Set<PortalKey> {
  const out = new Set<PortalKey>();
  for (const r of roles) {
    const allowed = ROLE_PORTALS[r];
    if (allowed) {
      for (const p of allowed) out.add(p);
    }
  }
  return out;
}

/**
 * In development we return a stub session with every portal enabled
 * so the scaffold is fully navigable. Production reads the session
 * from the BFF's `/internal/ai/bff/session` endpoint (wired by the
 * Keycloak JWT → Settings pipeline).
 */
export function devSession(): SessionUser {
  return {
    id: 'dev-user',
    name: 'Dev Operator',
    organization: 'HealthFlow',
    email: 'dev@healthflow.io',
    roles: ['hcx_admin'],
  };
}
