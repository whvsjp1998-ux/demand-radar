import { NextResponse } from "next/server";

export interface RedditPost {
  id: string;
  title: string;
  url: string;
  upvotes: number;
  comments: number;
  subreddit: string;
  created_date: string;
}

const SUBREDDITS = ["SideProject", "entrepreneur", "DataHoarder", "productivity"];
const KEYWORDS = [
  "I wish there was",
  "anyone know a tool",
  "how do I batch",
  "need a tool",
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchSubredditSearch(
  subreddit: string,
  keyword: string
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&sort=hot&limit=20&restrict_sr=1`;

  const res = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 300 }, // cache 5 min
  });

  if (!res.ok) return [];

  const json = await res.json();
  const children = json?.data?.children ?? [];

  return children.map((child: { data: Record<string, unknown> }) => {
    const d = child.data;
    const createdUtc = typeof d.created_utc === "number" ? d.created_utc : 0;
    return {
      id: String(d.id ?? ""),
      title: String(d.title ?? ""),
      url: `https://www.reddit.com${d.permalink ?? ""}`,
      upvotes: typeof d.ups === "number" ? d.ups : 0,
      comments: typeof d.num_comments === "number" ? d.num_comments : 0,
      subreddit: String(d.subreddit ?? subreddit),
      created_date: createdUtc
        ? new Date(createdUtc * 1000).toISOString().slice(0, 10)
        : "",
    };
  });
}

// Must contain at least one tool-signal word
const TOOL_SIGNALS = [
  "tool", "app", "software", "automat", "batch", "bulk", "script",
  "extension", "plugin", "bot", "generat", "convert", "extract", "export",
  "import", "sync", "integrat", "dashboard", "workflow", "utility", "saas",
  "platform", "rename", "resize", "compress", "parse", "format", "merge",
  "split", "backup", "deploy", "schedul", "template", "calculator", "scanner",
  "tracker", "monitor", "scrape", "api", "program", "website", "service",
  "build", "creat", "make a", "feature", "download", "upload", "organiz",
  "manag", "notif", "search tool", "find tool", "open source",
];

// Exclude posts clearly unrelated to software tools
const EXCLUDE_SIGNALS = [
  "wedding", "marriage", "divorce", "relationship", "dating",
  "recipe", "cooking", "baking", "meal", "food",
  "doctor", "medical", "health advice", "therapy", "mental health",
  "lawyer", "legal advice", "lawsuit", "attorney",
  "mortgage", "real estate", "property", "rent",
  "fashion", "clothes", "outfit", "gym routine", "workout plan",
  "grief", "funeral", "religion", "prayer",
];

function isToolRelated(title: string): boolean {
  const t = title.toLowerCase();
  if (EXCLUDE_SIGNALS.some((kw) => t.includes(kw))) return false;
  return TOOL_SIGNALS.some((kw) => t.includes(kw));
}

function dedup(posts: RedditPost[]): RedditPost[] {
  const seen = new Set<string>();
  return posts.filter((p) => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export async function GET() {
  try {
    // Fan out all requests concurrently, swallow individual failures
    const requests = SUBREDDITS.flatMap((sub) =>
      KEYWORDS.map((kw) =>
        fetchSubredditSearch(sub, kw).catch(() => [] as RedditPost[])
      )
    );

    const results = await Promise.all(requests);
    const all = dedup(results.flat());
    const posts = all.filter((p) => isToolRelated(p.title));

    posts.sort((a, b) => b.upvotes - a.upvotes);

    return NextResponse.json({ posts, total: posts.length, filtered: all.length - posts.length });
  } catch {
    return NextResponse.json({ posts: [], total: 0 });
  }
}
