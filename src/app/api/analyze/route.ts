import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT =
  "你是一个出海产品选品专家。用户给你一个英文论坛帖子标题，你需要判断这是否是一个值得做成工具站的需求。评分标准：搜索意图强(+30)、竞争少(+20)、用户愿付费(+20)、技术难度低(+15)、市场大(+15)。只返回 JSON，不要任何其他文字。示例格式：{\"ai_score\":85,\"ai_summary\":\"用一句中文描述需求痛点和机会\",\"keyword\":\"batch file renamer tool\",\"kd_estimate\":\"low\",\"tags\":[\"工具站\",\"SEO友好\"]}";

export interface AnalysisResult {
  ai_score: number;
  ai_summary: string;
  keyword: string;
  kd_estimate: "low" | "medium" | "high";
  tags: string[];
}

function extractJson(text: string): AnalysisResult | null {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch {}

  // Strip markdown code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  // Extract first {...} block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "MINIMAX_API_KEY not configured" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: title },
        ],
      }),
    });

    const rawText = await res.text();

    if (!res.ok) {
      console.error("[analyze] MiniMax HTTP", res.status, rawText.slice(0, 300));
      return NextResponse.json({ error: "upstream API error", detail: rawText.slice(0, 200) }, { status: 502 });
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("[analyze] non-JSON response:", rawText.slice(0, 300));
      return NextResponse.json({ error: "non-JSON response from MiniMax" }, { status: 502 });
    }

    // Log for debugging (server-side only)
    console.log("[analyze] raw data keys:", Object.keys(data));

    const content: string =
      (data?.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ??
      (data?.reply as string) ??
      "";

    console.log("[analyze] content:", content.slice(0, 300));

    const result = extractJson(content);

    if (!result) {
      console.error("[analyze] could not extract JSON from:", content);
      // Return a neutral fallback so the frontend doesn't stall
      return NextResponse.json({
        ai_score: 50,
        ai_summary: "AI 解析失败，请稍后重试。",
        keyword: "",
        kd_estimate: "medium",
        tags: ["工具需求"],
      } satisfies AnalysisResult);
    }

    return NextResponse.json({
      ai_score:    typeof result.ai_score === "number"
        ? Math.min(100, Math.max(0, Math.round(result.ai_score))) : 50,
      ai_summary:  typeof result.ai_summary === "string" ? result.ai_summary : "",
      keyword:     typeof result.keyword === "string" ? result.keyword : "",
      kd_estimate: (["low", "medium", "high"] as const).includes(result.kd_estimate as "low"|"medium"|"high")
        ? result.kd_estimate as "low"|"medium"|"high" : "medium",
      tags:        Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
    } satisfies AnalysisResult);
  } catch (err) {
    console.error("[analyze] unexpected error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
