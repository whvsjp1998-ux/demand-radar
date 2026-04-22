import { NextResponse } from "next/server";
import type { RedditPost } from "../fetch-reddit/route";

const QUERY = `
  query {
    posts(order: VOTES, first: 30) {
      edges {
        node {
          id
          name
          tagline
          url
          votesCount
          commentsCount
          createdAt
          topics {
            edges { node { name } }
          }
        }
      }
    }
  }
`;

// Tool-related topics to keep
const TOOL_TOPICS = [
  "productivity", "developer tools", "tech", "saas", "artificial intelligence",
  "no-code", "open source", "chrome extensions", "api", "automation",
  "design tools", "marketing", "analytics", "writing tools", "utilities",
];

export async function GET() {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token) {
    return NextResponse.json({ posts: [], total: 0, error: "PRODUCT_HUNT_TOKEN not configured" });
  }

  try {
    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: QUERY }),
      next: { revalidate: 600 }, // cache 10 min
    });

    if (!res.ok) {
      console.error("[producthunt] HTTP", res.status);
      return NextResponse.json({ posts: [], total: 0 });
    }

    const json = await res.json();
    const edges = json?.data?.posts?.edges ?? [];

    const posts: RedditPost[] = edges
      .filter((edge: { node: Record<string, unknown> }) => {
        const topics: string[] = ((edge.node.topics as { edges: { node: { name: string } }[] })?.edges ?? [])
          .map((t) => t.node.name.toLowerCase());
        return topics.some((t) => TOOL_TOPICS.some((kw) => t.includes(kw)));
      })
      .map((edge: { node: Record<string, unknown> }) => {
        const n = edge.node;
        const topics = ((n.topics as { edges: { node: { name: string } }[] })?.edges ?? [])
          .map((t) => t.node.name).join(", ");
        return {
          id: `ph_${n.id}`,
          title: `${n.name} — ${n.tagline}`,
          url: String(n.url ?? ""),
          upvotes: typeof n.votesCount === "number" ? n.votesCount : 0,
          comments: typeof n.commentsCount === "number" ? n.commentsCount : 0,
          subreddit: `PH · ${topics.slice(0, 40)}`,
          created_date: typeof n.createdAt === "string" ? n.createdAt.slice(0, 10) : "",
        };
      });

    posts.sort((a, b) => b.upvotes - a.upvotes);
    return NextResponse.json({ posts, total: posts.length });
  } catch (err) {
    console.error("[producthunt] error:", err);
    return NextResponse.json({ posts: [], total: 0 });
  }
}
