'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Menu, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/shared/language-toggle';
import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
}

export interface PortalShellProps {
  portal: {
    name: string;
    accent: 'provider' | 'payer' | 'siu' | 'regulatory';
    userName?: string;
    organization?: string;
  };
  nav: NavItem[];
  children: React.ReactNode;
}

const ACCENT_BG: Record<PortalShellProps['portal']['accent'], string> = {
  provider: 'bg-hcx-primary',
  payer: 'bg-hcx-success',
  siu: 'bg-hcx-investigate',
  regulatory: 'bg-hcx-warning',
};

export function PortalShell({ portal, nav, children }: PortalShellProps) {
  const pathname = usePathname();
  const t = useTranslations('common');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLogout = () => {
    // Redirect to Keycloak logout endpoint which clears the session
    window.location.href = '/api/auth/logout';
  };

  const navLinks = nav.map((item) => {
    const active =
      pathname === item.href ||
      (item.href !== '/' && pathname.startsWith(item.href));
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileNavOpen(false)}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-hcx-primary-light text-hcx-primary'
            : 'text-hcx-text hover:bg-accent hover:text-accent-foreground',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <span className="flex items-center gap-2">
          {item.icon}
          {item.label}
        </span>
        {item.badge && (
          <Badge variant="outline" className="text-xs">
            {item.badge}
          </Badge>
        )}
      </Link>
    );
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          {/* Hamburger menu for mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </Button>
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-md text-white',
              ACCENT_BG[portal.accent],
            )}
            aria-hidden
          >
            <span className="text-sm font-bold">HCX</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">{portal.name}</span>
            {portal.organization && (
              <span className="text-xs text-hcx-text-muted">
                {portal.organization}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {portal.userName && (
            <span className="hidden text-sm text-hcx-text md:inline">
              {portal.userName}
            </span>
          )}
          <Badge variant="outline">{portal.accent}</Badge>
          <LanguageToggle />
          <Link
            href="/"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          >
            {t('back')}
          </Link>
          {/* Fix #2: Logout button accessible from all screens */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-1.5 text-xs text-hcx-danger hover:bg-hcx-danger/10 hover:text-hcx-danger"
            aria-label={t('logout')}
          >
            <LogOut className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('logout')}</span>
          </Button>
        </div>
      </header>

      {/* Mobile navigation drawer overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile navigation drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 w-64 transform border-e border-border bg-card p-3 pt-16 transition-transform duration-200 md:hidden',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
        )}
        role="complementary"
      >
        <nav className="space-y-1" aria-label={portal.name} role="navigation">
          {navLinks}
        </nav>
      </aside>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-e border-border bg-card p-3 md:block" role="complementary">
          <nav className="space-y-1" aria-label={portal.name} role="navigation">
            {navLinks}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
