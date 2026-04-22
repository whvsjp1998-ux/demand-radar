import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import type { DbDemand } from "@/lib/supabase";

// GET /api/demands — load all persisted demands
export async function GET() {
  const client = db();
  if (!client) return NextResponse.json({ demands: [] });

  const { data, error } = await client
    .from("demands")
    .select("*")
    .order("upvotes", { ascending: false });

  if (error) {
    console.error("[demands] GET error:", error.message);
    return NextResponse.json({ demands: [] });
  }
  return NextResponse.json({ demands: data ?? [] });
}

// POST /api/demands — upsert one or many demands
export async function POST(req: NextRequest) {
  const client = db();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const rows: Partial<DbDemand>[] = Array.isArray(body) ? body : [body];

  const { error } = await client
    .from("demands")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("[demands] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/demands — update status for one demand
export async function PATCH(req: NextRequest) {
  const client = db();
  if (!client) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { id, status } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await client
    .from("demands")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("[demands] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
