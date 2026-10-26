/**
 * Reddit High-Intent Post Scraper
 * Uses Reddit's JSON search endpoint (native fetch) with fallback handling.
 */

export interface RedditLead {
  platform: 'reddit';
  title: string;
  selftext: string;
  url: string;
  created_utc: number;
  author?: string;
  subreddit?: string;
  scrapedAt: string;
}

export async function scrapeReddit(query: string = 'need crm', limit: number = 10): Promise<RedditLead[]> {
  const formattedQuery = encodeURIComponent(query).replace(/%20/g, '+');
  const endpoint = `https://www.reddit.com/search.json?q=${formattedQuery}&limit=${limit}`;
  console.log(`[Reddit Scraper] Querying Reddit public JSON endpoint: ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 LeadPilot/1.0',
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      console.error('[Reddit Scraper] Error: 429 Too Many Requests - Reddit rate limit exceeded.');
    } else if (res.status === 403) {
      console.error('[Reddit Scraper] Error: 403 Forbidden - Reddit network security / Cloudflare blocked direct request.');
    }

    if (!res.ok) {
      console.warn(`[Reddit Scraper] Direct Reddit endpoint returned status ${res.status}: ${res.statusText}`);
      // Fallback to PullPush Reddit archive API if direct endpoint is blocked or rate-limited
      console.log('[Reddit Scraper] Attempting PullPush Reddit public API fallback...');
      const fallbackUrl = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=${limit}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        const items = fallbackData?.data || [];
        const leads: RedditLead[] = items.map((d: any) => ({
          platform: 'reddit',
          title: d.title || 'Untitled Post',
          selftext: d.selftext || '',
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url || ''),
          created_utc: d.created_utc || Math.floor(Date.now() / 1000),
          author: d.author || 'anonymous',
          subreddit: d.subreddit_name_prefixed || (d.subreddit ? `r/${d.subreddit}` : 'r/reddit'),
          scrapedAt: new Date().toISOString(),
        }));
        console.log(`[Reddit Scraper] Fallback successfully retrieved ${leads.length} leads.`);
        return leads;
      }
      return [];
    }

    const data = await res.json();
    const children = data?.data?.children || [];

    const leads: RedditLead[] = children.map((item: any) => {
      const post = item.data || {};
      return {
        platform: 'reddit',
        title: post.title || 'Untitled Post',
        selftext: post.selftext || '',
        url: post.permalink ? `https://www.reddit.com${post.permalink}` : (post.url || ''),
        created_utc: post.created_utc || Math.floor(Date.now() / 1000),
        author: post.author || 'anonymous',
        subreddit: post.subreddit_name_prefixed || (post.subreddit ? `r/${post.subreddit}` : 'r/reddit'),
        scrapedAt: new Date().toISOString(),
      };
    });

    console.log(`[Reddit Scraper] Successfully extracted ${leads.length} leads from Reddit JSON API.`);
    return leads;
  } catch (err: any) {
    console.error(`[Reddit Scraper] Fetch error: ${err.message || err}`);
    return [];
  }
}
