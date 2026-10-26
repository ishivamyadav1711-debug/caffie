import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LLMProviderFactory } from '@/lib/ai/llmProvider';
import { enrichContact } from '@/lib/enrichment';

const PYTHON_SERVICE_URL = process.env.PYTHON_SCRAPER_URL || 'http://127.0.0.1:8000';

interface RawPost {
  platform: string;
  author: string;
  title: string;
  text: string;
  url: string;
}

// Deterministic heuristic fallback in case of LLM rate-limit or network timeout
function heuristicScore(title: string, text: string): { score: number; reason: string; intentCategory: string } {
  const combined = `${title} ${text}`.toLowerCase();
  const buySignals = [
    'looking for', 'need a', 'recommend', 'what software', 'alternative to',
    'seeking', 'pricing', 'budget', 'hire', 'anyone know a good', 'switching from', 'want to buy'
  ];
  const complaintSignals = [
    'hate', 'terrible', 'cancelling', 'broken', 'frustrated with', 'expensive',
    'unreliable', 'slow', 'leaving', 'tired of', 'cost too much'
  ];

  let buyMatches = 0;
  for (const sig of buySignals) {
    if (combined.includes(sig)) buyMatches++;
  }

  let complaintMatches = 0;
  for (const sig of complaintSignals) {
    if (combined.includes(sig)) complaintMatches++;
  }

  if (buyMatches > 0) {
    return {
      score: Math.min(98, 75 + buyMatches * 8),
      reason: `Expressed clear software requirement or buying intent (${buyMatches} buying signal phrases matched).`,
      intentCategory: 'buy_intent',
    };
  } else if (complaintMatches > 0) {
    return {
      score: Math.min(92, 70 + complaintMatches * 7),
      reason: `Expressed active dissatisfaction with current tool/vendor (${complaintMatches} replacement signals matched).`,
      intentCategory: 'complaint',
    };
  }

  return {
    score: 45,
    reason: 'General inquiry or discussion without urgent purchase signals.',
    intentCategory: 'product_evaluation',
  };
}

async function scoreWithAI(
  llm: any,
  title: string,
  text: string
): Promise<{ score: number; reason: string; intentCategory: string }> {
  if (!llm.isConfigured()) {
    return heuristicScore(title, text);
  }

  const systemInstruction = `You are an expert sales analyst identifying high-intent purchasing leads from social posts. Always output valid JSON strictly adhering to schema: {"score": number (0 to 100), "reason": "one sentence explanation", "intentCategory": "buy_intent" | "complaint" | "product_evaluation"}.`;

  const prompt = `Analyze this social post for commercial buying intent or software replacement need.
Title: ${title}
Content: ${text.slice(0, 500)}

Return JSON:
{
  "score": <0-100>,
  "reason": "<1-line explanation>",
  "intentCategory": "<buy_intent or complaint or product_evaluation>"
}`;

  try {
    const res = await Promise.race([
      llm.generateText(prompt, systemInstruction, { jsonMode: true, maxTokens: 500 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI scoring timed out')), 6000)),
    ]);

    let rawText = res.text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      rawText = jsonMatch[0];
    }
    const parsed = JSON.parse(rawText);

    return {
      score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
      reason: String(parsed.reason || 'AI scored intent based on purchase signals.').trim(),
      intentCategory: String(parsed.intentCategory || 'buy_intent').trim(),
    };
  } catch (err: any) {
    console.warn(`[AI Scoring Notice]: ${err.message}. Using fast fallback scoring.`);
    return heuristicScore(title, text);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = (body.keyword || 'looking for CRM').trim();

    console.log(`[Scrape Route] Fetching real data for keyword: "${keyword}"...`);

    let rawPosts: RawPost[] = [];

    // 1. Call Python microservice with 10-second AbortSignal
    try {
      const pyRes = await fetch(`${PYTHON_SERVICE_URL}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword }),
        signal: AbortSignal.timeout(10000),
      });

      if (pyRes.ok) {
        const pyData = await pyRes.json();
        rawPosts = pyData.results || [];
        console.log(`[Scrape Route] Python service returned ${rawPosts.length} real posts.`);
      }
    } catch (pyErr: any) {
      console.warn(`[Scrape Route] Python service call failed (${pyErr.message}). Using native fetch fallback.`);
    }

    // 2. Fallback to direct Hacker News and Reddit if Python service returned 0
    if (rawPosts.length === 0) {
      const hnUrl = `http://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}`;
      const redditUrl = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(keyword)}&size=8`;

      const [hnRes, redditRes] = await Promise.allSettled([
        fetch(hnUrl, { signal: AbortSignal.timeout(6000) }),
        fetch(redditUrl, { headers: { 'User-Agent': 'LeadPilot/1.0' }, signal: AbortSignal.timeout(6000) }),
      ]);

      if (hnRes.status === 'fulfilled' && hnRes.value.ok) {
        const data = await hnRes.value.json().catch(() => ({}));
        for (const hit of (data.hits || []).slice(0, 8)) {
          const title = hit.title || hit.story_title || 'Hacker News Post';
          rawPosts.push({
            platform: 'hackernews',
            author: hit.author || 'hn_user',
            title,
            text: hit.story_text || hit.comment_text || title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          });
        }
      }

      if (redditRes.status === 'fulfilled' && redditRes.value.ok) {
        const data = await redditRes.value.json().catch(() => ({}));
        for (const item of (data.data || []).slice(0, 8)) {
          const title = item.title || 'Reddit Post';
          rawPosts.push({
            platform: 'reddit',
            author: item.author || 'reddit_user',
            title,
            text: item.selftext || title,
            url: item.permalink ? `https://www.reddit.com${item.permalink}` : (item.url || 'https://reddit.com'),
          });
        }
      }
    }

    if (rawPosts.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No posts found for this keyword. Please try another search.',
        leads: [],
      });
    }

    // 3. AI Intent Scoring using Groq / OpenRouter provider
    const llm = LLMProviderFactory.getProvider();
    console.log(`[Scrape Route] Scoring ${rawPosts.length} posts with AI Provider (${llm.name})...`);

    const scoredLeads = [];

    // Process posts with bounded concurrency (5 at a time) to prevent timeouts
    const BATCH_SIZE = 5;
    for (let i = 0; i < rawPosts.length; i += BATCH_SIZE) {
      const batch = rawPosts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (post) => {
          const aiResult = await scoreWithAI(llm, post.title, post.text);

          let enrichedEmail: string | null = null;
          let enrichedProvider: string | null = null;
          let detectedCompany: string | null = null;

          // Auto-Enrichment if Intent Score >= 80
          if (aiResult.score >= 80 && post.author && post.author !== 'Anonymous') {
            try {
              const cleanAuthor = post.author.replace(/^[@u\/]/, '').trim();
              const nameParts = cleanAuthor.split(/[\s_.-]+/);
              const firstName = nameParts[0] || 'Member';
              const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

              // Parse potential company or domain from content
              const combinedText = `${post.title} ${post.text}`;
              const domainMatch = combinedText.match(/\b([a-zA-Z0-9-]+\.(?:com|io|co|ai|org|net))\b/i);
              const companyMatch = combinedText.match(/\b(?:at|founder of|work at|ceo of|with)\s+([A-Z][a-zA-Z0-9]{2,20})/);
              if (domainMatch) {
                detectedCompany = domainMatch[1];
              } else if (companyMatch) {
                detectedCompany = companyMatch[1];
              }

              console.log(`[Auto-Enrich] Lead score ${aiResult.score} >= 80. Enriching ${firstName} (Company: ${detectedCompany || firstName})...`);
              const enrichRes = await Promise.race([
                enrichContact({
                  first_name: firstName,
                  last_name: lastName,
                  company_name: detectedCompany || firstName,
                  company_domain: detectedCompany?.includes('.') ? detectedCompany : undefined,
                }),
                new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Enrichment timeout')), 4000)),
              ]).catch((err) => {
                console.warn(`[Auto-Enrich Warning]: ${err.message}`);
                return null;
              });

              if (enrichRes?.workEmail?.value) {
                enrichedEmail = enrichRes.workEmail.value;
                enrichedProvider = enrichRes.workEmail.provider || 'waterfall';
                console.log(`[Auto-Enrich Success] Found email: ${enrichedEmail} via ${enrichedProvider}`);
              }
            } catch (enrichErr: any) {
              console.warn(`[Auto-Enrich Error]: ${enrichErr.message}`);
            }
          }

          // Save/upsert into Prisma SocialLead
          const saved = await (prisma as any).socialLead.upsert({
            where: { url: post.url },
            update: {
              platform: post.platform,
              title: post.title,
              selftext: post.text || null,
              author: post.author || null,
              company: detectedCompany || undefined,
              score: aiResult.score,
              intentCategory: aiResult.intentCategory,
              reason: aiResult.reason,
              ...(enrichedEmail ? { enrichedEmail, enrichedProvider } : {}),
            },
            create: {
              platform: post.platform,
              title: post.title,
              selftext: post.text || null,
              url: post.url,
              author: post.author || null,
              company: detectedCompany || null,
              score: aiResult.score,
              intentCategory: aiResult.intentCategory,
              reason: aiResult.reason,
              enrichedEmail: enrichedEmail || null,
              enrichedProvider: enrichedProvider || null,
            },
          });

          return saved;
        })
      );
      scoredLeads.push(...batchResults);
    }

    // Sort by score descending
    scoredLeads.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      success: true,
      keyword,
      count: scoredLeads.length,
      leads: scoredLeads,
    });
  } catch (err: any) {
    console.error('[Scrape API Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Scraping and scoring failed' },
      { status: 500 }
    );
  }
}
