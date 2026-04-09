import { getTranslations } from 'next-intl/server';
import {
  Building2,
  Download,
  FileCheck,
  Globe,
  Map,
  ShieldAlert,
} from 'lucide-react';

import { PortalShell, type NavItem } from '@/components/layout/portal-shell';

export default async function RegulatoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations('nav');
  const tPortals = await getTranslations('portals');

  const nav: NavItem[] = [
    { label: tNav('marketOverview'), href: '/regulatory', icon: Globe },
    { label: tNav('insurers'), href: '/regulatory/insurers', icon: Building2 },
    { label: tNav('geographic'), href: '/regulatory/geographic', icon: Map },
    { label: tNav('fraudOversight'), href: '/regulatory/fraud', icon: ShieldAlert },
    { label: tNav('compliance'), href: '/regulatory/compliance', icon: FileCheck },
    { label: tNav('reports'), href: '/regulatory/reports', icon: Download },
  ];

  return (
    <PortalShell
      portal={{
        name: tPortals('regulatory.title'),
        accent: 'regulatory',
        organization: 'FRA — Egypt',
        userName: 'Supervisor Khaled',
      }}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
