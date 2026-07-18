import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { authSchema } from '@/lib/schemas';
import { z } from 'zod';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type AuthValues = z.infer<typeof authSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const handleLogin = async (data: AuthValues) => {
    setIsLoading(true);
    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;

      // Check for active connection
      const { data: connectionData, error: connectionError } = await supabase
        .from('okx_connections')
        .select('id')
        .eq('user_id', authData.user.id)
        .eq('active', true)
        .single();

      if (connectionData && !connectionError) {
        setLocation('/connected');
      } else {
        setLocation('/connect-okx');
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (data: AuthValues) => {
    setIsLoading(true);
    try {
      const { data: authData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;
      if (!authData.user) throw new Error('No user returned');

      // Upsert into users table
      const { error: upsertError } = await supabase.from('users').upsert({
        id: authData.user.id,
        email: authData.user.email,
      });

      if (upsertError) throw upsertError;

      setLocation('/connect-okx');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign up failed',
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-[420px] flex flex-col items-center mb-8">
        <ShieldCheck className="w-12 h-12 text-primary mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Guardian</h1>
        <p className="text-sm text-muted-foreground mt-2">Portfolio protection for OKX</p>
      </div>

      <Tabs defaultValue="login" className="w-full max-w-[420px]" data-testid="auth-tabs">
        <TabsList className="grid w-full grid-cols-2 mb-6 bg-card border border-card-border p-1">
          <TabsTrigger value="login" data-testid="tab-login" className="data-[state=active]:bg-background">
            Log In
          </TabsTrigger>
          <TabsTrigger value="signup" data-testid="tab-signup" className="data-[state=active]:bg-background">
            Sign Up
          </TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-0">
          <Card className="border-card-border bg-card">
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>Enter your credentials to access your vault.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="you@example.com" 
                            {...field} 
                            data-testid="input-login-email"
                            className="bg-input border-border focus-visible:ring-primary"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            {...field} 
                            data-testid="input-login-password"
                            className="bg-input border-border focus-visible:ring-primary"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground mt-2" 
                    disabled={isLoading}
                    data-testid="btn-login-submit"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Log In
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signup" className="mt-0">
          <Card className="border-card-border bg-card">
            <CardHeader>
              <CardTitle>Create your vault</CardTitle>
              <CardDescription>Secure your OKX account with Guardian.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSignUp)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="you@example.com" 
                            {...field} 
                            data-testid="input-signup-email"
                            className="bg-input border-border focus-visible:ring-primary"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            {...field} 
                            data-testid="input-signup-password"
                            className="bg-input border-border focus-visible:ring-primary"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground mt-2" 
                    disabled={isLoading}
                    data-testid="btn-signup-submit"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Sign Up
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
