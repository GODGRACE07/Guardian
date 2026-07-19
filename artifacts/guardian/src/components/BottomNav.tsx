import { useLocation, Link } from 'wouter';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';

const TABS = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/rules',     label: 'Rules',     Icon: ShieldCheck      },
] as const;

export function BottomNav() {
  const [location] = useLocation();

  return (
    <>
      {/* Spacer so content isn't hidden behind the fixed bar */}
      <div className="h-20" aria-hidden="true" />

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div
          className="w-full max-w-[420px] pointer-events-auto
                     bg-card/90 backdrop-blur-md border-t border-card-border
                     flex items-center"
        >
          {TABS.map(({ href, label, Icon }) => {
            const active = location === href || location.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'flex-1 flex flex-col items-center gap-1 py-3 transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
