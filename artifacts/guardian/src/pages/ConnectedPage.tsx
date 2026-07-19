import { useLocation, Link } from 'wouter';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ConnectedPage() {
  const [, setLocation] = useLocation();
  const { clearWalletSession } = useAuth();

  const handleSignOut = () => {
    clearWalletSession();
    setLocation('/auth');
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center py-12 px-4 bg-background">
      <div className="w-full max-w-[420px] text-center space-y-8">

        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <ShieldCheck className="w-12 h-12 text-primary" data-testid="icon-success" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Account Connected
          </h1>
          <p className="text-sm text-muted-foreground">
            Guardian is ready to protect your OKX portfolio.
          </p>
        </div>

        <Card className="border-card-border bg-card">
          <CardContent className="pt-6 flex flex-col items-center">
            <Link href="/rules" className="w-full">
              <Button
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground"
                data-testid="btn-setup-rules"
              >
                Set Up Protection Rules →
              </Button>
            </Link>
          </CardContent>
        </Card>

        <button
          onClick={handleSignOut}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
          data-testid="btn-sign-out"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
