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
    { label: tNav('dashboard'), href: '/provider', icon: <LayoutDashboard className="size-4" aria-hidden /> },
    { label: tNav('newClaim'), href: '/provider/claims/new', icon: <FilePlus className="size-4" aria-hidden /> },
    { label: tNav('eligibility'), href: '/provider/eligibility', icon: <ShieldCheck className="size-4" aria-hidden /> },
    { label: tNav('preAuth'), href: '/provider/preauth', icon: <ClipboardCheck className="size-4" aria-hidden /> },
    { label: tNav('claimsHistory'), href: '/provider/claims', icon: <FileStack className="size-4" aria-hidden /> },
    { label: tNav('denials'), href: '/provider/denials', icon: <AlertTriangle className="size-4" aria-hidden /> },
    { label: tNav('payments'), href: '/provider/payments', icon: <Banknote className="size-4" aria-hidden /> },
    { label: tNav('communications'), href: '/provider/communications', icon: <MessageSquare className="size-4" aria-hidden /> },
    { label: tNav('settings'), href: '/provider/settings', icon: <Settings className="size-4" aria-hidden /> },
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
