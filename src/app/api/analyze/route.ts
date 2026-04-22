import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const SYSTEM_PROMPT = `你是一个出海产品选品专家。用户给你最多10个英文论坛帖子标题（编号1-N），你需要逐条判断是否值得做成工具站。
评分标准：搜索意图强(+30)、竞争少(+20)、用户愿付费(+20)、技术难度低(+15)、市场大(+15)。
只返回 JSON 数组，不要任何其他文字。格式：
[
  {"index":1,"title_zh":"批量文件重命名工具","ai_score":85,"ai_summary":"一句中文描述需求痛点和机会","keyword":"batch file renamer tool","kd_estimate":"low","tags":["工具站","SEO友好"]},
  ...
]`;

export interface AnalysisResult {
  title_zh: string;
  ai_score: number;
  ai_summary: string;
  keyword: string;
  kd_estimate: "low" | "medium" | "high";
  tags: string[];
}

function extractJsonArray(text: string): unknown[] | null {
  try { const r = JSON.parse(text.trim()); if (Array.isArray(r)) return r; } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { const r = JSON.parse(fenced[1].trim()); if (Array.isArray(r)) return r; } catch {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { const r = JSON.parse(arrMatch[0]); if (Array.isArray(r)) return r; } catch {} }
  return null;
}

function normalize(raw: Record<string, unknown>): AnalysisResult {
  return {
    title_zh:    typeof raw.title_zh === "string" ? raw.title_zh : "",
    ai_score:    typeof raw.ai_score === "number" ? Math.min(100, Math.max(0, Math.round(raw.ai_score))) : 50,
    ai_summary:  typeof raw.ai_summary === "string" ? raw.ai_summary : "",
    keyword:     typeof raw.keyword === "string" ? raw.keyword : "",
    kd_estimate: (["low","medium","high"] as const).includes(raw.kd_estimate as "low"|"medium"|"high")
      ? raw.kd_estimate as "low"|"medium"|"high" : "medium",
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]).slice(0, 4) : [],
  };
}

const FALLBACK: AnalysisResult = {
  title_zh: "", ai_score: 50, ai_summary: "AI 分析暂时不可用", keyword: "", kd_estimate: "medium", tags: ["工具需求"],
};

// POST /api/analyze
// Body: { title: string } — single
//    OR { titles: Array<{id:string, title:string}> } — batch (up to 10)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 });

  // ── single mode (backward compat) ──────────────────────────────────────────
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

    const result = await analyzeBatch([{ id: "_", title }], apiKey);
    return NextResponse.json(result[0]?.result ?? FALLBACK);
  }

  // ── batch mode ─────────────────────────────────────────────────────────────
  if (!Array.isArray(body.titles) || body.titles.length === 0) {
    return NextResponse.json({ error: "titles array required" }, { status: 400 });
  }

  const items: Array<{ id: string; title: string }> = body.titles.slice(0, 10);
  const results = await analyzeBatch(items, apiKey);

  // persist to Supabase if configured
  const client = db();
  if (client) {
    const rows = results
      .filter((r) => r.result.ai_score !== 50)
      .map((r) => ({
        id: r.id,
        ai_score: r.result.ai_score,
        ai_summary: r.result.ai_summary,
        keyword: r.result.keyword,
        kd_estimate: r.result.kd_estimate,
        tags: r.result.tags,
        analyzed_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      client.from("demands").upsert(rows, { onConflict: "id" }).then(({ error }) => {
        if (error) console.error("[analyze] supabase upsert:", error.message);
      });
    }
  }

  return NextResponse.json(results);
}

async function analyzeBatch(
  items: Array<{ id: string; title: string }>,
  apiKey: string,
): Promise<Array<{ id: string; result: AnalysisResult }>> {
  const numbered = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");

  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    const res = await undiciFetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: numbered },
        ],
        temperature: 0.3,
      }),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]);

    if (!res.ok) {
      console.error("[analyze] DeepSeek HTTP", res.status, await res.text().then(t => t.slice(0,200)));
      return items.map((it) => ({ id: it.id, result: FALLBACK }));
    }

    const data = await res.json() as Record<string, unknown>;
    const content: string = (data?.choices as {message:{content:string}}[])?.[0]?.message?.content ?? "";
    console.log("[analyze] batch content:", content.slice(0, 300));

    const arr = extractJsonArray(content);
    if (!arr) return items.map((it) => ({ id: it.id, result: FALLBACK }));

    return items.map((it, i) => {
      const raw = arr.find((x) => (x as Record<string,unknown>).index === i + 1) ?? arr[i];
      return { id: it.id, result: raw ? normalize(raw as Record<string,unknown>) : FALLBACK };
    });
  } catch (err) {
    console.error("[analyze] error:", err);
    return items.map((it) => ({ id: it.id, result: FALLBACK }));
  }
}
