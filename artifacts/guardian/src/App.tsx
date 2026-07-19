import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';

import AuthPage from '@/pages/AuthPage';
import ConnectOkxPage from '@/pages/ConnectOkxPage';
import ConnectedPage from '@/pages/ConnectedPage';
import RulesPage from '@/pages/RulesPage';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function RootRedirect() {
  const { walletAddress } = useAuth();
  return walletAddress ? <Redirect to="/connected" /> : <Redirect to="/auth" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/auth" component={AuthPage} />

      <Route path="/connect-okx">
        {() => (
          <ProtectedRoute>
            <ConnectOkxPage />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/connected">
        {() => (
          <ProtectedRoute>
            <ConnectedPage />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/rules">
        {() => (
          <ProtectedRoute>
            <RulesPage />
          </ProtectedRoute>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
