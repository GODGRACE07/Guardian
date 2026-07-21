/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Full origin of the Guardian API server.
   *
   * Set this when deploying the frontend to a static host (e.g. Vercel) where
   * Replit's path-based proxy is not available to route /api/* requests.
   *
   * Example: "https://guardian-api.replit.app"
   *
   * Leave empty or unset for Replit dev/production deployments — the proxy
   * handles /api/* routing automatically.
   */
  readonly VITE_API_BASE_URL?: string;

  /** Supabase project URL (set in Replit shared env vars) */
  readonly VITE_SUPABASE_URL: string;

  /** Supabase anon key (set in Replit shared env vars) */
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
