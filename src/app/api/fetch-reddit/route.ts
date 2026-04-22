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
  "User-Agent": "DemandRadar/1.0 (research tool)",
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
    const posts = dedup(results.flat());

    // Sort by upvotes descending
    posts.sort((a, b) => b.upvotes - a.upvotes);

    return NextResponse.json({ posts, total: posts.length });
  } catch {
    return NextResponse.json({ posts: [], total: 0 });
  }
}
