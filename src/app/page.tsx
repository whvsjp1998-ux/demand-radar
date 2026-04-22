"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalysisResult } from "./api/analyze/route";

// ─── types ───────────────────────────────────────────────────────────────────

type Status = "待审核" | "可行" | "暂缓" | null;
type Filter = "全部" | "可行" | "待审核";

interface Tag {
  label: string;
  type: "green" | "red" | "neutral";
}

interface Demand {
  id: string;
  score: number; // computed fallback
  source: string;
  status: Status;
  title: string;
  likes: number;
  comments: number;
  date: string;
  url: string;
  tags: Tag[];
}

interface RedditPost {
  id: string;
  title: string;
  url: string;
  upvotes: number;
  comments: number;
  subreddit: string;
  created_date: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function calcScore(upvotes: number, comments: number): number {
  return Math.min(99, Math.max(35, Math.round(
    50 + Math.log10(upvotes + 1) * 15 + Math.log10(comments + 1) * 8,
  )));
}

function generateTags(title: string, score: number): Tag[] {
  const t = title.toLowerCase();
  const tags: Tag[] = [];
  if (t.includes("ai") || t.includes("gpt") || t.includes("llm"))
    tags.push({ label: "AI工具", type: "green" });
  if (t.includes("batch") || t.includes("bulk") || t.includes("500+"))
    tags.push({ label: "批量处理", type: "green" });
  if (t.includes("free") || t.includes("open source"))
    tags.push({ label: "免费", type: "neutral" });
  if (score >= 85) tags.push({ label: "高意图", type: "green" });
  if (tags.length === 0) tags.push({ label: "工具需求", type: "neutral" });
  return tags.slice(0, 3);
}

function aiTagsToTagObjects(aiTags: string[]): Tag[] {
  const red = ["高竞争", "低意图", "难变现", "技术复杂"];
  const green = ["SEO友好", "高意图", "工具站", "低竞争", "强相关", "高价值", "可行"];
  return aiTags.map((label) => ({
    label,
    type: red.includes(label) ? "red" : green.includes(label) ? "green" : "neutral",
  }));
}

function redditToDemand(post: RedditPost): Demand {
  const score = calcScore(post.upvotes, post.comments);
  return {
    id: post.id,
    score,
    source: `r/${post.subreddit}`,
    status: null,
    title: post.title,
    likes: post.upvotes,
    comments: post.comments,
    date: post.created_date,
    url: post.url,
    tags: generateTags(post.title, score),
  };
}

function scoreColor(score: number) {
  if (score >= 80) return { text: "text-emerald-600", border: "border-emerald-100", stroke: "text-emerald-500" };
  if (score >= 65) return { text: "text-zinc-500", border: "border-zinc-100", stroke: "text-zinc-200" };
  return { text: "text-amber-600", border: "border-amber-100", stroke: "text-amber-500" };
}

function strokeOffset(score: number) {
  return 188.5 - (score / 100) * 188.5;
}

const KD_LABEL: Record<string, { label: string; cls: string }> = {
  low:    { label: "低竞争", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  medium: { label: "中等竞争", cls: "bg-amber-50 text-amber-700 border-amber-100" },
  high:   { label: "高竞争", cls: "bg-red-50 text-red-700 border-red-100" },
};

// ─── sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  if (!status) return null;
  const styles: Record<string, string> = {
    待审核: "bg-amber-50 text-amber-600 border border-amber-100",
    可行:   "bg-emerald-50 text-emerald-600 border border-emerald-100",
    暂缓:   "bg-zinc-50 text-zinc-400 border border-zinc-100",
  };
  return (
    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-zinc-100 p-6 rounded-xl animate-pulse">
      <div className="flex gap-4">
        <div className="w-14 h-14 rounded-full bg-zinc-100 shrink-0" />
        <div className="flex-1 space-y-3 py-1">
          <div className="flex justify-between">
            <div className="h-3 w-28 bg-zinc-100 rounded" />
            <div className="h-3 w-14 bg-zinc-100 rounded-full" />
          </div>
          <div className="h-4 w-full bg-zinc-100 rounded" />
          <div className="h-4 w-3/4 bg-zinc-100 rounded" />
          <div className="flex gap-2 pt-1">
            <div className="h-3 w-12 bg-zinc-100 rounded" />
            <div className="h-3 w-16 bg-zinc-100 rounded" />
            <div className="h-3 w-16 bg-zinc-100 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AiScoreSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="flex items-baseline justify-between">
        <div className="h-4 w-32 bg-zinc-100 rounded" />
        <div className="h-6 w-20 bg-zinc-100 rounded" />
      </div>
      <div className="h-2 bg-zinc-100 rounded-full" />
      <div className="h-12 w-full bg-zinc-50 rounded-lg mt-2" />
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

const ANALYZE_BATCH = 3; // concurrent AI requests at a time

export default function Page() {
  const [demands, setDemands]       = useState<Demand[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter]         = useState<Filter>("全部");
  const [statuses, setStatuses]     = useState<Record<string, Status>>({});

  // AI analysis state
  const [analyses, setAnalyses]         = useState<Record<string, AnalysisResult>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  const analyzeAll = useCallback(async (demandList: Demand[]) => {
    for (let i = 0; i < demandList.length; i += ANALYZE_BATCH) {
      const batch = demandList.slice(i, i + ANALYZE_BATCH);

      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        batch.forEach((d) => next.add(d.id));
        return next;
      });

      await Promise.all(
        batch.map(async (d) => {
          try {
            const res = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: d.title }),
            });
            if (!res.ok) throw new Error("failed");
            const result: AnalysisResult = await res.json();
            setAnalyses((prev) => ({ ...prev, [d.id]: result }));
          } catch {
            // silently skip; card keeps computed score
          } finally {
            setAnalyzingIds((prev) => {
              const next = new Set(prev);
              next.delete(d.id);
              return next;
            });
          }
        }),
      );
    }
  }, []);

  const fetchReddit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fetch-reddit");
      if (!res.ok) throw new Error("network error");
      const { posts }: { posts: RedditPost[] } = await res.json();
      const mapped = posts.map(redditToDemand);
      setDemands(mapped);
      setAnalyses({});
      setAnalyzingIds(new Set());
      if (mapped.length > 0) setSelectedId(mapped[0].id);
      // start AI analysis after data is displayed
      analyzeAll(mapped);
    } catch {
      setError("获取 Reddit 数据失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [analyzeAll]);

  useEffect(() => { fetchReddit(); }, [fetchReddit]);

  function updateStatus(id: string, status: Status) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  const demandsWithStatus = demands.map((d) => ({
    ...d,
    status: statuses[d.id] ?? null,
  }));

  const filtered = demandsWithStatus.filter((d) => {
    if (filter === "可行")   return d.status === "可行";
    if (filter === "待审核") return d.status === "待审核";
    return true;
  });

  const selected = demandsWithStatus.find((d) => d.id === selectedId) ?? null;
  const selectedAnalysis = selected ? (analyses[selected.id] ?? null) : null;
  const selectedAnalyzing = selected ? analyzingIds.has(selected.id) : false;

  const stats = {
    today:    demands.length,
    viable:   Object.values(statuses).filter((s) => s === "可行").length,
    pending:  Object.values(statuses).filter((s) => s === "待审核").length,
    avgScore: demands.length
      ? Math.round(demands.reduce((a, d) => {
          const ai = analyses[d.id];
          return a + (ai ? ai.ai_score : d.score);
        }, 0) / demands.length)
      : 0,
  };

  const kdInfo = selectedAnalysis ? KD_LABEL[selectedAnalysis.kd_estimate] : null;

  return (
    <div className="flex h-screen overflow-hidden text-[#181c23]" style={{ backgroundColor: "#f9f9ff" }}>
      {/* Sidebar */}
      <aside className="w-64 h-screen border-r border-zinc-200/50 bg-zinc-50/50 backdrop-blur-xl flex flex-col pt-8 pb-4 shrink-0">
        <div className="px-6 mb-8">
          <h1 className="text-blue-600 font-black tracking-widest uppercase text-xs">Demand Radar</h1>
          <p className="text-[10px] text-zinc-400 font-medium tracking-widest mt-1">INTELLIGENCE SUITE</p>
        </div>
        <nav className="flex-1">
          <a href="#" className="flex items-center text-blue-600 font-bold border-r-2 border-blue-600 pl-4 py-3 mx-2 rounded-l-lg transition-all hover:bg-zinc-200/30">
            <span className="material-symbols-outlined mr-3">radar</span>
            <span className="text-[13px] font-medium">Market Radar</span>
          </a>
        </nav>
        <div className="px-6 pt-4 border-t border-zinc-200/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">A</div>
            <div className="flex flex-col">
              <span className="text-xs font-bold">Alex Chen</span>
              <span className="text-[10px] text-zinc-500">Premium Plan</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex justify-between items-center h-16 px-6 sticky top-0 z-50 w-full bg-white/70 backdrop-blur-2xl shadow-[0_1px_0_0_rgba(0,0,0,0.05)] border-b border-zinc-200/50">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative max-w-md w-full">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-lg">search</span>
              <input className="w-full bg-zinc-100/50 border-none rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" placeholder="Search signals or markets..." type="text" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            {analyzingIds.size > 0 && (
              <span className="text-[11px] text-blue-500 font-medium flex items-center gap-1">
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                AI 分析中 {Object.keys(analyses).length}/{demands.length}
              </span>
            )}
            <button onClick={fetchReddit} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100/50 transition-all" title="刷新数据">
              <span className={`material-symbols-outlined text-zinc-600 ${loading ? "animate-spin" : ""}`}>refresh</span>
            </button>
            <div className="h-6 w-px bg-zinc-200 mx-2" />
            <span className="text-sm font-semibold tracking-tight text-zinc-900">市场雷达 (Market Radar)</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 flex overflow-hidden p-8 gap-6">
          {/* Feed column */}
          <div className="flex-1 flex flex-col min-w-0 space-y-6 overflow-y-auto no-scrollbar">

            {/* Stats */}
            <div className="grid grid-cols-4 gap-5">
              {[
                { label: "今日新增",   value: loading ? "—" : stats.today,    icon: "add_chart",   color: "text-blue-600" },
                { label: "可行需求",   value: loading ? "—" : stats.viable,   icon: "check_circle", color: "text-emerald-600" },
                { label: "待审核",     value: loading ? "—" : stats.pending,  icon: "pending",      color: "text-amber-500" },
                { label: "平均AI评分", value: loading ? "—" : stats.avgScore, icon: "psychology",   color: "text-purple-500" },
              ].map((card) => (
                <div key={card.label} className="glass-card p-6 rounded-xl flex flex-col">
                  <span className="text-[13px] text-zinc-500 mb-1">{card.label}</span>
                  <div className="flex items-end justify-between">
                    <span className="text-[32px] font-bold leading-none text-zinc-900">{card.value}</span>
                    <span className={`material-symbols-outlined mb-1 ${card.color}`}>{card.icon}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 p-1 bg-zinc-100/50 rounded-lg">
                {(["全部", "可行", "待审核"] as Filter[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${filter === f ? "bg-white shadow-sm text-blue-600" : "text-zinc-500 hover:text-zinc-800"}`}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-zinc-400">排序方式:</span>
                <button className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-1.5 rounded-md text-sm font-medium text-zinc-700">
                  按热度 <span className="material-symbols-outlined text-sm">expand_more</span>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <span className="material-symbols-outlined text-base">error</span>
                {error}
              </div>
            )}

            {/* Cards */}
            <div className="space-y-4">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
                  <span className="material-symbols-outlined" style={{ fontSize: 40 }}>search_off</span>
                  <p className="text-sm">当前筛选条件下暂无数据</p>
                </div>
              ) : (
                filtered.map((demand) => {
                  const ai = analyses[demand.id];
                  const isAnalyzing = analyzingIds.has(demand.id);
                  const displayScore = ai ? ai.ai_score : demand.score;
                  const colors = scoreColor(displayScore);
                  const isActive = demand.id === selectedId;
                  const displayTags = ai ? aiTagsToTagObjects(ai.tags) : demand.tags;

                  return (
                    <div
                      key={demand.id}
                      onClick={() => setSelectedId(demand.id)}
                      className={`group relative bg-white p-6 rounded-xl cursor-pointer transition-all ${
                        isActive
                          ? "border-2 border-blue-500 ring-4 ring-blue-100/60 shadow-sm"
                          : "border border-zinc-200 hover:border-zinc-300 shadow-sm"
                      }`}
                    >
                      <div className="flex gap-4">
                        {/* Score ring */}
                        <div className="relative shrink-0 flex items-center justify-center w-14 h-14">
                          <div className={`absolute inset-0 rounded-full border-4 ${colors.border}`} />
                          {isAnalyzing ? (
                            <span className="material-symbols-outlined text-zinc-300 animate-spin z-10" style={{ fontSize: 20 }}>
                              progress_activity
                            </span>
                          ) : (
                            <span className={`text-lg font-bold z-10 ${colors.text}`}>{displayScore}</span>
                          )}
                          {!isAnalyzing && (
                            <svg className="absolute -inset-1 w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                              <circle className={colors.stroke} cx="32" cy="32" fill="transparent" r="30"
                                stroke="currentColor" strokeDasharray="188.5"
                                strokeDashoffset={strokeOffset(displayScore)} strokeWidth="3" />
                            </svg>
                          )}
                          {ai && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center" title="AI已分析">
                              <span className="text-white text-[8px] font-bold">AI</span>
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 bg-orange-500 rounded flex items-center justify-center">
                                <span className="text-[10px] text-white font-bold">R</span>
                              </div>
                              <span className="text-[12px] text-zinc-500 font-bold uppercase tracking-wider">{demand.source}</span>
                            </div>
                            <StatusBadge status={demand.status} />
                          </div>
                          <h3 className="text-[16px] font-semibold text-zinc-900 mb-3 group-hover:text-blue-600 transition-colors leading-snug line-clamp-2">
                            {demand.title}
                          </h3>
                          {/* AI summary on card if available */}
                          {ai?.ai_summary && (
                            <p className="text-[12px] text-zinc-400 mb-2 line-clamp-1">{ai.ai_summary}</p>
                          )}
                          <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center gap-1.5 text-zinc-400">
                              <span className="material-symbols-outlined text-base">thumb_up</span>
                              <span className="text-xs font-medium">{demand.likes.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-zinc-400">
                              <span className="material-symbols-outlined text-base">chat_bubble</span>
                              <span className="text-xs font-medium">{demand.comments} 评论</span>
                            </div>
                            <span className="text-xs text-zinc-300">{demand.date}</span>
                            <div className="ml-auto flex gap-2 flex-wrap justify-end">
                              {displayTags.map((tag) => (
                                <span key={tag.label} className={`tag-${tag.type} text-[10px] font-bold px-2 py-0.5 rounded-md uppercase`}>
                                  {tag.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail panel */}
          <aside className="w-[440px] shrink-0 sticky top-0 overflow-y-auto no-scrollbar">
            {!selected ? (
              <div className="glass-card rounded-xl min-h-full flex flex-col items-center justify-center gap-4 p-8 text-center shadow-xl">
                <span className="material-symbols-outlined text-zinc-300" style={{ fontSize: 48 }}>radar</span>
                <p className="text-zinc-400 text-sm">点击左侧卡片查看详情</p>
              </div>
            ) : (
              <div className="glass-card rounded-xl flex flex-col shadow-xl border-zinc-200 min-h-full">
                {/* Panel header */}
                <div className="p-6 border-b border-zinc-200/50">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold">R</div>
                      <div>
                        <h4 className="text-sm font-bold text-zinc-900">Reddit / {selected.source}</h4>
                        <span className="text-xs text-zinc-400">{selected.date}</span>
                      </div>
                    </div>
                    <button className="text-zinc-400 hover:text-zinc-600">
                      <span className="material-symbols-outlined">more_vert</span>
                    </button>
                  </div>
                  <h2 className="text-[22px] font-semibold text-zinc-900 leading-tight mb-4">{selected.title}</h2>
                  <a href={selected.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-bold rounded-lg hover:bg-zinc-800 transition-all w-full justify-center">
                    <span className="material-symbols-outlined text-lg">open_in_new</span>
                    查看原始帖子 (View Original Post)
                  </a>
                </div>

                {/* Panel body */}
                <div className="p-6 flex-1 space-y-6 overflow-y-auto no-scrollbar">

                  {/* AI score */}
                  {selectedAnalyzing ? (
                    <AiScoreSkeleton />
                  ) : selectedAnalysis ? (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">AI 可行性评分</span>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded uppercase">
                            {selectedAnalysis.ai_score >= 90 ? "极力推荐" : selectedAnalysis.ai_score >= 80 ? "推荐" : selectedAnalysis.ai_score >= 65 ? "可考虑" : "谨慎"}
                          </span>
                        </div>
                        <span className="text-[24px] font-semibold text-emerald-600">{selectedAnalysis.ai_score}/100</span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${selectedAnalysis.ai_score}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">热度评分</span>
                        <span className="text-[24px] font-semibold text-zinc-600">{selected.score}/100</span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-zinc-300 rounded-full" style={{ width: `${selected.score}%` }} />
                      </div>
                    </div>
                  )}

                  {/* AI summary */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                      AI 需求洞察
                    </h4>
                    {selectedAnalyzing ? (
                      <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 animate-pulse">
                        <div className="space-y-2">
                          <div className="h-3 bg-blue-100 rounded w-full" />
                          <div className="h-3 bg-blue-100 rounded w-5/6" />
                          <div className="h-3 bg-blue-100 rounded w-4/6" />
                        </div>
                      </div>
                    ) : selectedAnalysis?.ai_summary ? (
                      <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                        <p className="text-[15px] text-zinc-800 leading-relaxed">{selectedAnalysis.ai_summary}</p>
                      </div>
                    ) : (
                      <div className="bg-zinc-50/80 p-4 rounded-lg border border-zinc-100 flex items-center gap-3 text-zinc-400">
                        <span className="material-symbols-outlined text-xl shrink-0">lock</span>
                        <p className="text-[13px] leading-relaxed">AI 分析排队中，稍后自动更新。</p>
                      </div>
                    )}
                  </div>

                  {/* SEO keyword + KD */}
                  {selectedAnalysis && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">SEO 关键词</h4>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                          <span className="material-symbols-outlined text-zinc-400 text-base">key</span>
                          <span className="text-sm font-medium text-zinc-800">{selectedAnalysis.keyword}</span>
                        </div>
                        {kdInfo && (
                          <span className={`px-3 py-2 text-[11px] font-bold rounded-lg border ${kdInfo.cls}`}>
                            {kdInfo.label}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">标签</h4>
                    {selectedAnalyzing ? (
                      <div className="flex gap-2 animate-pulse">
                        <div className="h-6 w-16 bg-zinc-100 rounded-md" />
                        <div className="h-6 w-20 bg-zinc-100 rounded-md" />
                        <div className="h-6 w-14 bg-zinc-100 rounded-md" />
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(selectedAnalysis
                          ? aiTagsToTagObjects(selectedAnalysis.tags)
                          : selected.tags
                        ).map((tag) => (
                          <span key={tag.label} className={`tag-${tag.type} text-[12px] font-semibold px-3 py-1 rounded-md`}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-50/80 border border-zinc-100 rounded-lg p-3 flex flex-col gap-1">
                      <span className="text-[11px] text-zinc-400 uppercase tracking-wider">点赞数</span>
                      <span className="text-[22px] font-bold text-zinc-900">{selected.likes.toLocaleString()}</span>
                    </div>
                    <div className="bg-zinc-50/80 border border-zinc-100 rounded-lg p-3 flex flex-col gap-1">
                      <span className="text-[11px] text-zinc-400 uppercase tracking-wider">评论数</span>
                      <span className="text-[22px] font-bold text-zinc-900">{selected.comments.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="pt-2 space-y-2">
                    <button onClick={() => updateStatus(selected.id, "可行")}
                      className={`w-full flex items-center justify-center gap-2 py-3 font-bold rounded-lg shadow-md transition-all ${
                        selected.status === "可行" ? "bg-emerald-600 text-white" : "bg-emerald-500 text-white hover:bg-emerald-600"
                      }`}>
                      <span className="material-symbols-outlined text-lg">check_circle</span>
                      标记为可行 (Go)
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => updateStatus(selected.id, "待审核")}
                        className={`flex items-center justify-center gap-2 py-2.5 border font-semibold rounded-lg transition-all ${
                          selected.status === "待审核" ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                        }`}>
                        <span className="material-symbols-outlined text-lg">pending</span> 待审核
                      </button>
                      <button onClick={() => updateStatus(selected.id, "暂缓")}
                        className={`flex items-center justify-center gap-2 py-2.5 border font-semibold rounded-lg transition-all ${
                          selected.status === "暂缓" ? "bg-zinc-100 border-zinc-300 text-zinc-500" : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                        }`}>
                        <span className="material-symbols-outlined text-lg">pause_circle</span> 暂缓
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </main>
      </div>

      {/* Background */}
      <div className="fixed -bottom-32 -left-32 w-96 h-96 rounded-full pointer-events-none -z-10" style={{ background: "rgba(0,88,188,0.05)", filter: "blur(120px)" }} />
      <div className="fixed top-20 -right-20 w-80 h-80 rounded-full pointer-events-none -z-10" style={{ background: "rgba(16,185,129,0.05)", filter: "blur(100px)" }} />
    </div>
  );
}
