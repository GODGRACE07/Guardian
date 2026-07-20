/**
 * Server-side Supabase client for the background worker.
 *
 * Uses the same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars as the
 * frontend (they are available to the server process too).  The anon key is
 * sufficient because the database's RLS policies are set to permissive — no
 * Supabase Auth session exists for wallet-based accounts.
 */

import { createClient } from '@supabase/supabase-js';

const url  = process.env['VITE_SUPABASE_URL'];
const anonKey = process.env['VITE_SUPABASE_ANON_KEY'];

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. ' +
    'The Guardian background worker cannot start without Supabase credentials.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Disable all Supabase Auth behaviour — we use wallet auth, not email/password
    persistSession:    false,
    autoRefreshToken:  false,
    detectSessionInUrl: false,
  },
});
