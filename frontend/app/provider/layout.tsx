import { getTranslations } from 'next-intl/server';
import {
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  FilePlus,
  FileStack,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
} from 'lucide-react';

import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations('nav');
  const tPortals = await getTranslations('portals');

  const nav: NavItem[] = [
    { label: tNav('dashboard'), href: '/provider', icon: LayoutDashboard },
    { label: tNav('newClaim'), href: '/provider/claims/new', icon: FilePlus },
    { label: tNav('eligibility'), href: '/provider/eligibility', icon: ShieldCheck },
    { label: tNav('preAuth'), href: '/provider/preauth', icon: ClipboardCheck },
    { label: tNav('claimsHistory'), href: '/provider/claims', icon: FileStack },
    { label: tNav('denials'), href: '/provider/denials', icon: AlertTriangle },
    { label: tNav('payments'), href: '/provider/payments', icon: Banknote },
    { label: tNav('communications'), href: '/provider/communications', icon: MessageSquare },
    { label: tNav('settings'), href: '/provider/settings', icon: Settings },
  ];

  return (
    <PortalShell
      portal={{
        name: tPortals('provider.title'),
        accent: 'provider',
        organization: 'Kasr El Aini Hospital',
        userName: 'Dr. Fatma Abdelrahman',
      }}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
