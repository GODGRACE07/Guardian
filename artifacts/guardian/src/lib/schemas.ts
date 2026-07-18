import { z } from 'zod';

export const authSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const okxConnectionSchema = z.object({
  api_key: z.string().min(1, 'API Key is required'),
  api_secret: z.string().min(1, 'API Secret is required'),
  api_passphrase: z.string().min(1, 'API Passphrase is required'),
  is_demo: z.boolean().default(true),
});
