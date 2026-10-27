import re
import urllib.parse
from typing import List, Optional
import requests
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI(
    title="Leads Scraper Service",
    description="Python Scraper for Reddit & Hacker News with Wheel Alloy Percentage Selector and Sorting",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScrapedPost(BaseModel):
    platform: str  # "hackernews" | "reddit"
    author: str
    title: str
    text: str
    url: str
    match_percentage: int
    intent_signal: str


class ScrapeRequest(BaseModel):
    keyword: str = "wheel alloy"
    min_percentage: int = 0
    limit: int = 25


class ScrapeResponse(BaseModel):
    success: bool
    keyword: str
    min_percentage: int
    count: int
    results: List[ScrapedPost]


def calculate_match_percentage(title: str, text: str, query: str) -> tuple[int, str]:
    """Calculates a relevance and intent percentage (0-100%) for a given post based on query and buying signals."""
    combined = f"{title} {text}".lower()
    q_lower = query.lower().strip()
    words = [w for w in re.split(r"\s+", q_lower) if len(w) > 1]

    score = 20  # Base visibility score
    reasons = []

    # 1. Exact phrase match (+45%)
    if q_lower in combined:
        score += 45
        reasons.append("Exact phrase match")
    else:
        # Partial token matches
        matched_tokens = [w for w in words if w in combined]
        if matched_tokens:
            token_ratio = len(matched_tokens) / max(1, len(words))
            token_score = int(token_ratio * 35)
            score += token_score
            reasons.append(f"Matched {len(matched_tokens)}/{len(words)} keywords")

    # 2. Automotive / Wheel Alloy specific context signals (+15%)
    wheel_signals = [
        "alloy", "wheel", "wheels", "rim", "rims", "fitment", "offset",
        "pcd", "spoke", "forged", "cast", "tyre", "tire", "mag", "lug"
    ]
    matched_wheel_signals = [s for s in wheel_signals if s in combined]
    if matched_wheel_signals:
        bonus = min(15, len(matched_wheel_signals) * 5)
        score += bonus
        reasons.append(f"Automotive context ({', '.join(matched_wheel_signals[:3])})")

    # 3. Commercial / Buying / Seeking intent signals (+20%)
    intent_signals = [
        "looking for", "need a", "recommend", "where to buy", "best place",
        "wtb", "anyone selling", "price", "pricing", "budget", "cost",
        "buying", "wanted", "supplier", "dealer", "quote", "fit", "upgrade"
    ]
    matched_intent = [s for s in intent_signals if s in combined]
    if matched_intent:
        bonus = min(20, len(matched_intent) * 7)
        score += bonus
        reasons.append("Active buyer/recommendation intent")

    # 4. Title weighting bonus (if keywords are in title, +10%)
    title_lower = title.lower()
    if any(w in title_lower for w in words):
        score += 10

    final_percentage = max(15, min(99, score))
    summary_reason = " • ".join(reasons) if reasons else "Topic match"

    return final_percentage, summary_reason


def fetch_hacker_news(keyword: str, max_items: int = 15) -> List[ScrapedPost]:
    posts: List[ScrapedPost] = []
    try:
        url = f"https://hn.algolia.com/api/v1/search?query={urllib.parse.quote(keyword)}&hitsPerPage={max_items}"
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            hits = res.json().get("hits", [])
            for hit in hits:
                title = hit.get("title") or hit.get("story_title") or "Hacker News Discussion"
                text = hit.get("story_text") or hit.get("comment_text") or title
                author = hit.get("author") or "hn_user"
                obj_id = hit.get("objectID")
                post_url = hit.get("url") or (f"https://news.ycombinator.com/item?id={obj_id}" if obj_id else "https://news.ycombinator.com")

                pct, reason = calculate_match_percentage(title, text, keyword)
                posts.append(
                    ScrapedPost(
                        platform="hackernews",
                        author=author,
                        title=title.strip(),
                        text=re.sub(r"<[^>]+>", " ", text).strip()[:500],
                        url=post_url,
                        match_percentage=pct,
                        intent_signal=reason,
                    )
                )
    except Exception as e:
        print(f"[HN Scraper Error]: {e}")

    return posts


def fetch_reddit(keyword: str, max_items: int = 15) -> List[ScrapedPost]:
    posts: List[ScrapedPost] = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }

    # 1. Primary Reliable Reddit Archive API (PullPush)
    try:
        url = f"https://api.pullpush.io/reddit/search/submission/?q={urllib.parse.quote(keyword)}&size={max_items}"
        res = requests.get(url, headers=headers, timeout=8)
        if res.status_code == 200:
            data = res.json().get("data", [])
            for item in data:
                title = item.get("title") or "Reddit Discussion"
                selftext = item.get("selftext") or title
                if selftext in ["[removed]", "[deleted]"]:
                    selftext = title
                author = item.get("author") or "reddit_user"
                permalink = item.get("permalink")
                post_url = f"https://www.reddit.com{permalink}" if permalink else (item.get("url") or "https://reddit.com")

                pct, reason = calculate_match_percentage(title, selftext, keyword)
                posts.append(
                    ScrapedPost(
                        platform="reddit",
                        author=author if author != "[deleted]" else "Reddit User",
                        title=title.strip(),
                        text=selftext.strip()[:500],
                        url=post_url,
                        match_percentage=pct,
                        intent_signal=reason,
                    )
                )
    except Exception as e:
        print(f"[PullPush Notice]: {e}")

    # 2. Direct Reddit Public Search (Fallback)
    if len(posts) == 0:
        try:
            url = f"https://www.reddit.com/search.json?q={urllib.parse.quote(keyword)}&limit={max_items}"
            res = requests.get(url, headers=headers, timeout=8)
            if res.status_code == 200:
                data = res.json()
                children = data.get("data", {}).get("children", [])
                for child in children:
                    item = child.get("data", {})
                    title = item.get("title") or "Reddit Post"
                    selftext = item.get("selftext") or title
                    author = item.get("author") or "reddit_user"
                    permalink = item.get("permalink")
                    post_url = f"https://www.reddit.com{permalink}" if permalink else (item.get("url") or "https://reddit.com")

                    pct, reason = calculate_match_percentage(title, selftext, keyword)
                    posts.append(
                        ScrapedPost(
                            platform="reddit",
                            author=author if author != "[deleted]" else "Reddit User",
                            title=title.strip(),
                            text=selftext.strip()[:500],
                            url=post_url,
                            match_percentage=pct,
                            intent_signal=reason,
                        )
                    )
        except Exception as e:
            print(f"[Reddit Direct Notice]: {e}")

    # 3. Arctic Shift (Third Fallback)
    if len(posts) == 0:
        subreddits = ["Wheels", "Cartalk", "MechanicAdvice", "cars", "Autos", "sales"]
        for sub in subreddits[:3]:
            if len(posts) >= max_items:
                break
            try:
                url = f"https://arctic-shift.photon-reddit.com/api/posts/search?subreddit={sub}&limit={max_items}"
                res = requests.get(url, headers=headers, timeout=8)
                if res.status_code == 200:
                    data = res.json().get("data", [])
                    for item in data:
                        title = item.get("title") or "Reddit Post"
                        selftext = item.get("selftext") or title
                        author = item.get("author") or "reddit_user"
                        permalink = item.get("permalink")
                        post_url = f"https://www.reddit.com{permalink}" if permalink else "https://reddit.com"

                        pct, reason = calculate_match_percentage(title, selftext, keyword)
                        posts.append(
                            ScrapedPost(
                                platform="reddit",
                                author=author if author != "[deleted]" else "Reddit User",
                                title=title.strip(),
                                text=selftext.strip()[:500],
                                url=post_url,
                                match_percentage=pct,
                                intent_signal=reason,
                            )
                        )
            except Exception as e:
                print(f"[Arctic-Shift Fallback Notice]: {e}")

    return posts


def scrape_and_sort(keyword: str, min_percentage: int = 0, limit: int = 30) -> List[ScrapedPost]:
    hn_posts = fetch_hacker_news(keyword, max_items=15)
    reddit_posts = fetch_reddit(keyword, max_items=15)

    combined: List[ScrapedPost] = []
    seen_urls = set()

    for p in hn_posts + reddit_posts:
        if p.url not in seen_urls:
            seen_urls.add(p.url)
            if p.match_percentage >= min_percentage:
                combined.append(p)

    # Sort strictly percentage-wise in descending order (highest % first)
    combined.sort(key=lambda item: item.match_percentage, reverse=True)

    return combined[:limit]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "python-leads-scraper",
        "platforms": ["reddit", "hackernews"],
        "version": "2.1.0",
    }


@app.post("/scrape", response_model=ScrapeResponse)
def scrape_post(req: ScrapeRequest):
    results = scrape_and_sort(
        keyword=req.keyword,
        min_percentage=req.min_percentage,
        limit=req.limit,
    )
    return ScrapeResponse(
        success=True,
        keyword=req.keyword,
        min_percentage=req.min_percentage,
        count=len(results),
        results=results,
    )


@app.get("/scrape", response_model=ScrapeResponse)
def scrape_get(
    keyword: str = Query("wheel alloy", description="Search query/keyword"),
    min_percentage: int = Query(0, ge=0, le=100, description="Minimum match percentage threshold"),
    limit: int = Query(25, ge=1, le=100, description="Maximum number of results"),
):
    results = scrape_and_sort(
        keyword=keyword,
        min_percentage=min_percentage,
        limit=limit,
    )
    return ScrapeResponse(
        success=True,
        keyword=keyword,
        min_percentage=min_percentage,
        count=len(results),
        results=results,
    )


@app.get("/", response_class=HTMLResponse)
def serve_ui():
    """Serves a modern, interactive single-page application with search bar, wheel alloy percentage selector, and percentage-sorted results."""
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Leads Scraper — Python Reddit & Hacker News Intelligence</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0B0F17;
      --card-bg: #111827;
      --card-border: #1F2937;
      --accent-cyan: #06B6D4;
      --accent-teal: #10B981;
      --accent-indigo: #6366F1;
      --accent-amber: #F59E0B;
      --accent-rose: #F43F5E;
      --text-primary: #F9FAFB;
      --text-secondary: #94A3B8;
      --text-muted: #64748B;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      width: 100%;
    }
    header {
      border-bottom: 1px solid var(--card-border);
      background: rgba(11, 15, 23, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .header-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #06B6D4, #3B82F6);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
      font-weight: 800;
      font-size: 1.25rem;
      color: white;
    }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge {
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      letter-spacing: 0.05em;
    }
    .nav-links {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    .nav-link {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
      transition: color 0.2s;
    }
    .nav-link:hover { color: var(--text-primary); }

    /* Hero / Search Section */
    .hero-card {
      background: linear-gradient(180deg, #131D2F 0%, var(--card-bg) 100%);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 2.25rem;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5);
      margin-bottom: 2rem;
      position: relative;
      overflow: hidden;
    }
    .hero-card::before {
      content: '';
      position: absolute;
      top: -100px;
      right: -100px;
      width: 300px;
      height: 300px;
      background: radial-gradient(circle, rgba(6, 182, 212, 0.15) 0%, transparent 70%);
      pointer-events: none;
    }
    .hero-heading {
      font-size: 1.75rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #FFFFFF, #94A3B8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero-sub {
      color: var(--text-secondary);
      font-size: 0.95rem;
      margin-bottom: 1.75rem;
    }

    /* Search Controls */
    .search-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.85rem;
      margin-bottom: 1.5rem;
    }
    @media (max-width: 768px) {
      .search-row { grid-template-columns: 1fr; }
    }
    .search-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 1.15rem;
      color: var(--text-muted);
      width: 20px;
      height: 20px;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      padding: 0.95rem 1rem 0.95rem 3rem;
      background: #0D131F;
      border: 1px solid #2A374A;
      border-radius: 14px;
      color: var(--text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: all 0.2s;
    }
    .search-input:focus {
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.2);
      background: #111A29;
    }
    .btn-search {
      padding: 0 1.75rem;
      background: linear-gradient(135deg, #06B6D4, #2563EB);
      color: white;
      border: none;
      border-radius: 14px;
      font-size: 0.95rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
      transition: all 0.2s;
      min-height: 52px;
    }
    .btn-search:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(6, 182, 212, 0.5);
    }

    /* Percentage Selector Section */
    .selector-box {
      background: #0D131F;
      border: 1px solid #1F2A3C;
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .selector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .selector-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .percentage-display {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--accent-cyan);
      background: rgba(6, 182, 212, 0.12);
      padding: 0.25rem 0.75rem;
      border-radius: 8px;
      border: 1px solid rgba(6, 182, 212, 0.3);
    }
    .slider-wrap {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .percentage-slider {
      flex: 1;
      -webkit-appearance: none;
      height: 8px;
      border-radius: 5px;
      background: #1F2937;
      outline: none;
      cursor: pointer;
      accent-color: var(--accent-cyan);
    }
    .preset-pills {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .preset-btn {
      background: #151F30;
      border: 1px solid #233147;
      color: var(--text-secondary);
      padding: 0.35rem 0.8rem;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .preset-btn:hover, .preset-btn.active {
      background: rgba(6, 182, 212, 0.15);
      color: var(--accent-cyan);
      border-color: rgba(6, 182, 212, 0.4);
    }

    /* Keyword suggestion tags */
    .suggestions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .sugg-label {
      font-size: 0.78rem;
      color: var(--text-muted);
      font-weight: 600;
    }
    .sugg-chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-secondary);
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .sugg-chip:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
    }

    /* Metrics Bar */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
      position: relative;
    }
    .metric-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .metric-val {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }

    /* Results Header */
    .results-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .results-count {
      font-size: 1.1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .sort-indicator {
      font-size: 0.8rem;
      color: var(--accent-cyan);
      font-weight: 600;
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.2);
      padding: 0.35rem 0.75rem;
      border-radius: 8px;
    }
    .actions-group {
      display: flex;
      gap: 0.5rem;
    }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-secondary);
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-outline:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-primary);
      border-color: #374151;
    }

    /* Leads Grid */
    .leads-grid {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .lead-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.2s;
      position: relative;
    }
    .lead-card:hover {
      border-color: #374151;
      transform: translateY(-2px);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .lead-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.85rem;
      gap: 1rem;
    }
    .lead-meta {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .platform-tag {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .platform-reddit {
      background: rgba(255, 69, 0, 0.15);
      color: #FF5722;
      border: 1px solid rgba(255, 69, 0, 0.3);
    }
    .platform-hackernews {
      background: rgba(255, 102, 0, 0.15);
      color: #FF8533;
      border: 1px solid rgba(255, 102, 0, 0.3);
    }
    .author-name {
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .rank-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-muted);
    }

    /* Radial / Badge Percentage Pill */
    .percentage-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      font-weight: 800;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .pct-high {
      background: rgba(16, 185, 129, 0.15);
      color: #10B981;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .pct-med {
      background: rgba(99, 102, 241, 0.15);
      color: #818CF8;
      border: 1px solid rgba(99, 102, 241, 0.35);
    }
    .pct-low {
      background: rgba(245, 158, 11, 0.15);
      color: #FBBF24;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }

    .lead-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.6rem;
      line-height: 1.4;
    }
    .lead-title a {
      color: inherit;
      text-decoration: none;
      transition: color 0.15s;
    }
    .lead-title a:hover {
      color: var(--accent-cyan);
    }
    .lead-text {
      color: var(--text-secondary);
      font-size: 0.88rem;
      line-height: 1.6;
      margin-bottom: 1.15rem;
    }
    .lead-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.85rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .signal-text {
      font-size: 0.75rem;
      color: #38BDF8;
      background: rgba(56, 189, 248, 0.08);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-weight: 500;
    }
    .card-actions {
      display: flex;
      gap: 0.5rem;
    }
    .btn-link {
      font-size: 0.8rem;
      color: var(--text-primary);
      background: #1E293B;
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.15s;
    }
    .btn-link:hover {
      background: #334155;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--card-bg);
      border: 1px dashed var(--card-border);
      border-radius: 16px;
    }
    .empty-icon {
      font-size: 2.5rem;
      margin-bottom: 1rem;
      color: var(--text-muted);
    }
    .loading-spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255,255,255,0.2);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s ease-in-out infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    footer {
      margin-top: auto;
      border-top: 1px solid var(--card-border);
      padding: 1.5rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-title">Leads Scraper</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">Reddit & Hacker News Python Engine</div>
        </div>
        <span class="badge">Live v2.1</span>
      </div>
      <div class="nav-links">
        <a href="/docs" target="_blank" class="nav-link">Swagger Docs</a>
        <a href="/health" target="_blank" class="nav-link">Health API</a>
      </div>
    </div>
  </header>

  <main class="container">
    <!-- Hero / Search Card -->
    <div class="hero-card">
      <h1 class="hero-heading">High-Intent Social Scraper</h1>
      <p class="hero-sub">Extract real-time discussions, score purchase intent percentage, and sort percentage-wise across Reddit & Hacker News.</p>

      <form id="searchForm" class="search-row" onsubmit="event.preventDefault(); triggerScrape();">
        <div class="search-input-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input 
            type="text" 
            id="keywordInput" 
            class="search-input" 
            placeholder="Search keyword (e.g., wheel alloy, looking for alloy wheels, CRM)..." 
            value="wheel alloy" 
            required
          />
        </div>
        <button type="submit" id="searchBtn" class="btn-search">
          <span>Scrape & Sort</span>
          <span id="btnIcon">⚡</span>
        </button>
      </form>

      <!-- Wheel Alloy Percentage Selector -->
      <div class="selector-box">
        <div class="selector-header">
          <div class="selector-title">
            <span>⚙️ Wheel Alloy Percentage Selector</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(Filter items below this threshold)</span>
          </div>
          <div class="percentage-display" id="pctDisplay">≥ 0%</div>
        </div>

        <div class="slider-wrap">
          <span style="font-size: 0.75rem; color: var(--text-muted);">0%</span>
          <input 
            type="range" 
            id="pctSlider" 
            class="percentage-slider" 
            min="0" 
            max="95" 
            value="0" 
            step="5"
            oninput="handleSliderChange(this.value)"
          />
          <span style="font-size: 0.75rem; color: var(--text-muted);">95%</span>
        </div>

        <div class="preset-pills">
          <button type="button" class="preset-btn active" onclick="setPreset(0, this)">All Matches (0%+)</button>
          <button type="button" class="preset-btn" onclick="setPreset(50, this)">Moderate (50%+)</button>
          <button type="button" class="preset-btn" onclick="setPreset(70, this)">High Intent (70%+)</button>
          <button type="button" class="preset-btn" onclick="setPreset(85, this)">Top Matches (85%+)</button>
        </div>
      </div>

      <!-- Quick Suggestion Chips -->
      <div class="suggestions">
        <span class="sugg-label">Quick Suggestions:</span>
        <span class="sugg-chip" onclick="quickSearch('wheel alloy')">wheel alloy</span>
        <span class="sugg-chip" onclick="quickSearch('looking for alloy wheels')">looking for alloy wheels</span>
        <span class="sugg-chip" onclick="quickSearch('forged rims fitment')">forged rims fitment</span>
        <span class="sugg-chip" onclick="quickSearch('looking for CRM')">looking for CRM</span>
        <span class="sugg-chip" onclick="quickSearch('sales automation tools')">sales automation tools</span>
      </div>
    </div>

    <!-- Metrics Bar -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-title">Total Leads Extracted</div>
        <div class="metric-val" id="metricTotal">0</div>
        <div class="metric-sub">Hacker News & Reddit posts</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">High Intent (≥ 70%)</div>
        <div class="metric-val" style="color: #10B981;" id="metricHigh">0</div>
        <div class="metric-sub">Strong buying/match signals</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Average Match Score</div>
        <div class="metric-val" style="color: #06B6D4;" id="metricAvg">0%</div>
        <div class="metric-sub">Normalized percentage</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Top Match Percentage</div>
        <div class="metric-val" style="color: #818CF8;" id="metricTop">0%</div>
        <div class="metric-sub">Highest ranked post</div>
      </div>
    </div>

    <!-- Results Section -->
    <div class="results-bar">
      <div class="results-count">
        <span id="resultsCountText">Showing 0 Results</span>
        <span class="sort-indicator">Sorted Percentage-Wise (Highest to Lowest ↓)</span>
      </div>
      <div class="actions-group">
        <button class="btn-outline" onclick="exportData('json')">Export JSON</button>
        <button class="btn-outline" onclick="exportData('csv')">Export CSV</button>
      </div>
    </div>

    <!-- Leads Grid -->
    <div id="leadsContainer" class="leads-grid">
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>Ready to Scrape</h3>
        <p style="color: var(--text-muted); font-size: 0.88rem; margin-top: 0.5rem;">
          Click "Scrape & Sort" above to extract live data from Reddit & Hacker News.
        </p>
      </div>
    </div>
  </main>

  <footer>
    LeadPilot Python Scraper Service • Isolated Push for dev-bharatreviews-cloud/Leads-Scraper
  </footer>

  <script>
    let allLeads = [];
    let currentMinPct = 0;

    async function triggerScrape() {
      const keyword = document.getElementById('keywordInput').value.trim();
      if (!keyword) return;

      const btn = document.getElementById('searchBtn');
      const btnIcon = document.getElementById('btnIcon');
      const container = document.getElementById('leadsContainer');

      btn.disabled = true;
      btnIcon.innerHTML = '<span class="loading-spinner"></span>';
      container.innerHTML = `
        <div class="empty-state">
          <div class="loading-spinner" style="width:36px; height:36px; margin-bottom:1rem; border-color:rgba(6,182,212,0.2); border-top-color:#06B6D4;"></div>
          <h3>Scraping Reddit & Hacker News...</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; margin-top: 0.4rem;">
            Extracting discussions, computing match percentages, and ordering results...
          </p>
        </div>
      `;

      try {
        const response = await fetch(`/scrape?keyword=${encodeURIComponent(keyword)}&min_percentage=0&limit=30`);
        const data = await response.json();

        if (data.success && Array.isArray(data.results)) {
          allLeads = data.results;
          applyFilterAndRender();
        } else {
          container.innerHTML = `<div class="empty-state"><h3>No results found</h3><p style="color:var(--text-muted);margin-top:0.5rem;">Try another keyword like "wheel alloy".</p></div>`;
        }
      } catch (err) {
        container.innerHTML = `<div class="empty-state"><h3 style="color:#F43F5E;">Scraping Error</h3><p style="color:var(--text-muted);margin-top:0.5rem;">${err.message}</p></div>`;
      } finally {
        btn.disabled = false;
        btnIcon.textContent = '⚡';
      }
    }

    function handleSliderChange(val) {
      currentMinPct = parseInt(val, 10);
      document.getElementById('pctDisplay').textContent = `≥ ${currentMinPct}%`;
      updatePresetActive(currentMinPct);
      applyFilterAndRender();
    }

    function setPreset(val, btn) {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pctSlider').value = val;
      handleSliderChange(val);
    }

    function updatePresetActive(val) {
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.remove('active');
        if (b.textContent.includes(`${val}%`)) {
          b.classList.add('active');
        }
      });
    }

    function quickSearch(kw) {
      document.getElementById('keywordInput').value = kw;
      triggerScrape();
    }

    function applyFilterAndRender() {
      const filtered = allLeads.filter(l => l.match_percentage >= currentMinPct);
      
      // Update metrics
      document.getElementById('metricTotal').textContent = filtered.length;
      document.getElementById('metricHigh').textContent = filtered.filter(l => l.match_percentage >= 70).length;
      
      const avg = filtered.length > 0 
        ? Math.round(filtered.reduce((sum, l) => sum + l.match_percentage, 0) / filtered.length) 
        : 0;
      document.getElementById('metricAvg').textContent = `${avg}%`;
      
      const top = filtered.length > 0 ? filtered[0].match_percentage : 0;
      document.getElementById('metricTop').textContent = `${top}%`;
      
      document.getElementById('resultsCountText').textContent = `Showing ${filtered.length} of ${allLeads.length} Results`;

      const container = document.getElementById('leadsContainer');
      if (filtered.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🎯</div>
            <h3>No leads above ${currentMinPct}%</h3>
            <p style="color:var(--text-muted); font-size:0.88rem; margin-top:0.4rem;">
              Adjust the Wheel Alloy percentage selector slider to a lower threshold to view more items.
            </p>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map((lead, idx) => {
        const pctClass = lead.match_percentage >= 75 ? 'pct-high' : lead.match_percentage >= 55 ? 'pct-med' : 'pct-low';
        const platformClass = lead.platform === 'reddit' ? 'platform-reddit' : 'platform-hackernews';
        const platformLabel = lead.platform === 'reddit' ? 'Reddit' : 'Hacker News';

        return `
          <div class="lead-card">
            <div class="lead-top">
              <div class="lead-meta">
                <span class="rank-tag">#${idx + 1}</span>
                <span class="platform-tag ${platformClass}">${platformLabel}</span>
                <span class="author-name">u/${escapeHtml(lead.author)}</span>
              </div>
              <div class="percentage-badge ${pctClass}">
                <span>${lead.match_percentage}%</span>
                <span style="font-size:0.75rem; font-weight:normal; opacity:0.8;">match</span>
              </div>
            </div>

            <h3 class="lead-title">
              <a href="${escapeHtml(lead.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(lead.title)}
              </a>
            </h3>

            <p class="lead-text">
              ${escapeHtml(lead.text || 'No additional content snippet provided.')}
            </p>

            <div class="lead-footer">
              <span class="signal-text">✨ ${escapeHtml(lead.intent_signal)}</span>
              <div class="card-actions">
                <button class="btn-link" onclick="copyToClipboard('${escapeHtml(lead.url)}', this)">
                  Copy Link
                </button>
                <a href="${escapeHtml(lead.url)}" target="_blank" rel="noopener noreferrer" class="btn-link" style="background:#0284C7;">
                  Open Post ↗
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }

    function exportData(type) {
      if (allLeads.length === 0) {
        alert('Please run a scrape search first.');
        return;
      }
      const filtered = allLeads.filter(l => l.match_percentage >= currentMinPct);
      if (type === 'json') {
        const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'leads_scraper_results.json');
      } else if (type === 'csv') {
        const headers = ['Rank', 'Platform', 'Match Percentage', 'Intent Signal', 'Author', 'Title', 'URL'];
        const rows = filtered.map((l, i) => [
          i + 1,
          l.platform,
          `${l.match_percentage}%`,
          `"${(l.intent_signal || '').replace(/"/g, '""')}"`,
          `"${(l.author || '').replace(/"/g, '""')}"`,
          `"${(l.title || '').replace(/"/g, '""')}"`,
          `"${l.url}"`
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        downloadBlob(blob, 'leads_scraper_results.csv');
      }
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // Auto-scrape on initial load
    window.addEventListener('DOMContentLoaded', () => {
      triggerScrape();
    });
  </script>
</body>
</html>
"""
    return HTMLResponse(content=html_content)


if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 65)
    print("  STARTING LEADS SCRAPER SERVICE (Reddit & Hacker News)")
    print("  UI Dashboard: http://localhost:8000")
    print("  API Docs:     http://localhost:8000/docs")
    print("=" * 65 + "\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
