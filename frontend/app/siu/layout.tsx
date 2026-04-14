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
    { label: tNav('dashboard'), href: '/siu', icon: <LayoutDashboard className="size-4" aria-hidden /> },
    { label: tNav('flaggedClaims'), href: '/siu/flagged', icon: <AlertTriangle className="size-4" aria-hidden /> },
    { label: tNav('investigations'), href: '/siu/investigations', icon: <Search className="size-4" aria-hidden /> },
    { label: tNav('networkAnalysis'), href: '/siu/network', icon: <Network className="size-4" aria-hidden /> },
    { label: tNav('crossPayerSearch'), href: '/siu/search', icon: <Database className="size-4" aria-hidden /> },
    { label: tNav('reports'), href: '/siu/reports', icon: <FileText className="size-4" aria-hidden /> },
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
