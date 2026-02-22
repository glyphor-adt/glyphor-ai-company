import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example → .env.local and fill in values.',
  );
}

export const supabase = createClient<Database>(url ?? '', key ?? '');

export const SCHEDULER_URL = (import.meta.env.VITE_SCHEDULER_URL as string) ?? '';
