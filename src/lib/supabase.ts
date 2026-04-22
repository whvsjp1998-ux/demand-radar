import { createClient } from "@supabase/supabase-js";

export interface DbDemand {
  id: string;
  title: string;
  url: string;
  upvotes: number;
  comments: number;
  source: string;
  created_date: string;
  status: string | null;
  ai_score: number | null;
  ai_summary: string | null;
  keyword: string | null;
  kd_estimate: string | null;
  tags: string[] | null;
  analyzed_at: string | null;
  fetched_at: string;
}

export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
