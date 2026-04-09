import { getTranslations } from 'next-intl/server';
import {
  AlertTriangle,
  Database,
  FileText,
  LayoutDashboard,
  Network,
  Search,
} from 'lucide-react';

import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

export default async function SiuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations('nav');
  const tPortals = await getTranslations('portals');

  const nav: NavItem[] = [
    { label: tNav('dashboard'), href: '/siu', icon: LayoutDashboard },
    { label: tNav('flaggedClaims'), href: '/siu/flagged', icon: AlertTriangle },
    { label: tNav('investigations'), href: '/siu/investigations', icon: Search },
    { label: tNav('networkAnalysis'), href: '/siu/network', icon: Network },
    { label: tNav('crossPayerSearch'), href: '/siu/search', icon: Database },
    { label: tNav('reports'), href: '/siu/reports', icon: FileText },
  ];

  return (
    <PortalShell
      portal={{
        name: tPortals('siu.title'),
        accent: 'siu',
        organization: 'HCX — SIU',
        userName: 'Nadia Farouk',
      }}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
