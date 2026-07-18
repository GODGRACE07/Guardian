import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { okxConnectionSchema } from '@/lib/schemas';
import { useAuth } from '@/contexts/AuthContext';
import { z } from 'zod';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ConnectionValues = z.infer<typeof okxConnectionSchema>;

export default function ConnectOkxPage() {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const form = useForm<ConnectionValues>({
    resolver: zodResolver(okxConnectionSchema),
    defaultValues: {
      api_key: '',
      api_secret: '',
      api_passphrase: '',
      is_demo: true,
    },
  });

  const isDemoMode = form.watch('is_demo');

  const onSubmit = async (data: ConnectionValues) => {
    if (!userId) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.from('okx_connections').insert({
        user_id: userId,
        api_key: data.api_key,
        api_secret: data.api_secret,
        api_passphrase: data.api_passphrase,
        is_demo: data.is_demo,
        connected_at: new Date().toISOString(),
        active: true,
      });

      if (error) throw error;

      setLocation('/connected');
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast({
        variant: 'destructive',
        title: 'Connection failed',
        description: err.message ?? 'Something went wrong. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center py-12 px-4 bg-background">
      <div className="w-full max-w-[420px] space-y-6">

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connect OKX</h1>
          <p className="text-sm text-muted-foreground">Link your API keys to enable protection.</p>
        </div>

        {/* Warning Box */}
        <div
          className="bg-[#451a03] border border-[#f59e0b] rounded-xl p-4 flex gap-3 shadow-sm"
          data-testid="warning-box"
        >
          <AlertTriangle className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5" />
          <p className="text-sm text-[#f59e0b]/90 leading-relaxed font-medium">
            Only grant Read and Trade permissions on your OKX API key. Never enable Withdraw.
            Guardian can never move your funds out of your OKX account.
          </p>
        </div>

        <Card className="border-card-border bg-card">
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

                {/* Trading Mode Toggle */}
                <FormField
                  control={form.control}
                  name="is_demo"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel>Trading Mode</FormLabel>
                      <div
                        className="flex bg-input rounded-lg p-1 border border-border"
                        data-testid="toggle-trading-mode"
                      >
                        <button
                          type="button"
                          onClick={() => field.onChange(true)}
                          data-testid="mode-demo"
                          className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition-colors ${
                            field.value
                              ? 'bg-card text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Demo Trading
                        </button>
                        <button
                          type="button"
                          onClick={() => field.onChange(false)}
                          data-testid="mode-live"
                          className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition-colors ${
                            !field.value
                              ? 'bg-card text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Live Trading
                        </button>
                      </div>
                      {!isDemoMode && (
                        <p
                          className="text-xs text-[#f59e0b] font-medium mt-2"
                          data-testid="live-warning-text"
                        >
                          Live trading uses real funds.
                        </p>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="api_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter your API Key"
                          {...field}
                          data-testid="input-api-key"
                          className="bg-input border-border focus-visible:ring-primary font-mono text-sm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="api_secret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Secret</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showSecret ? 'text' : 'password'}
                            placeholder="Enter your API Secret"
                            {...field}
                            data-testid="input-api-secret"
                            className="bg-input border-border focus-visible:ring-primary pr-10 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSecret(!showSecret)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            data-testid="toggle-secret-visibility"
                          >
                            {showSecret ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="api_passphrase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Passphrase</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassphrase ? 'text' : 'password'}
                            placeholder="Enter your API Passphrase"
                            {...field}
                            data-testid="input-api-passphrase"
                            className="bg-input border-border focus-visible:ring-primary pr-10 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassphrase(!showPassphrase)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            data-testid="toggle-passphrase-visibility"
                          >
                            {showPassphrase ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="pt-4">
                  <Button
                    type="submit"
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11"
                    disabled={isLoading}
                    data-testid="btn-connect-submit"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Connect Account
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
