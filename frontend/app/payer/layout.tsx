import { getTranslations } from 'next-intl/server';
import {
  BarChart3,
  CheckSquare,
  ClipboardCheck,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldAlert,
} from 'lucide-react';

import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

export default async function PayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations('nav');
  const tPortals = await getTranslations('portals');

  const nav: NavItem[] = [
    { label: tNav('dashboard'), href: '/payer', icon: <LayoutDashboard className="size-4" aria-hidden /> },
    { label: tNav('claimsQueue'), href: '/payer/claims', icon: <Inbox className="size-4" aria-hidden /> },
    { label: tNav('preAuth'), href: '/payer/preauth', icon: <ClipboardCheck className="size-4" aria-hidden /> },
    { label: tNav('settledClaims'), href: '/payer/settled', icon: <CheckSquare className="size-4" aria-hidden /> },
    { label: tNav('fraudAlerts'), href: '/payer/fraud', icon: <ShieldAlert className="size-4" aria-hidden /> },
    { label: tNav('analytics'), href: '/payer/analytics', icon: <BarChart3 className="size-4" aria-hidden /> },
    { label: tNav('communications'), href: '/payer/communications', icon: <MessageSquare className="size-4" aria-hidden /> },
    { label: tNav('settings'), href: '/payer/settings', icon: <Settings className="size-4" aria-hidden /> },
  ];

  return (
    <PortalShell
      portal={{
        name: tPortals('payer.title'),
        accent: 'payer',
        organization: 'Misr Insurance',
        userName: 'Ahmed El-Masry',
      }}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
