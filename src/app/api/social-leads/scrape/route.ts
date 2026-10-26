import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enrichContact } from '@/lib/enrichment';

const PYTHON_SERVICE_URL = process.env.PYTHON_SCRAPER_URL || 'http://127.0.0.1:8000';

interface RawScrapedLead {
  platform: string;
  author: string;
  title: string;
  text: string;
  url: string;
  score: number;
  intentCategory: string;
  reason: string;
  createdAt: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = body.keyword || 'looking for a CRM';
    const limit = body.limit || 10;

    console.log(`[Social Scrape API] Querying social intent service for keyword: "${keyword}"...`);

    let rawLeads: RawScrapedLead[] = [];

    // 1. Try calling the Python microservice (Obsei + Mentio pipeline)
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/scrape-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, limit }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        rawLeads = data.leads || [];
        console.log(`[Social Scrape API] Python microservice returned ${rawLeads.length} leads.`);
      }
    } catch (pyErr: any) {
      console.warn(`[Social Scrape API] Python microservice unavailable (${pyErr.message}). Using native fallback fetch.`);
    }

    // 2. Resilient Native Fallback if microservice returned no leads
    if (rawLeads.length === 0) {
      const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=5`;
      const redditUrl = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(keyword)}&size=5`;

      const [hnRes, redditRes] = await Promise.allSettled([
        fetch(hnUrl, { headers: { 'User-Agent': 'LeadPilot/1.0' }, signal: AbortSignal.timeout(6000) }),
        fetch(redditUrl, { headers: { 'User-Agent': 'LeadPilot/1.0' }, signal: AbortSignal.timeout(6000) }),
      ]);

      if (hnRes.status === 'fulfilled' && hnRes.value.ok) {
        const hnData = await hnRes.value.json().catch(() => ({}));
        for (const hit of hnData.hits || []) {
          const title = hit.title || hit.story_title || 'Hacker News Post';
          rawLeads.push({
            platform: 'hackernews',
            author: hit.author || 'hn_user',
            title,
            text: hit.story_text || title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            score: 88,
            intentCategory: 'buy_intent',
            reason: 'Software purchase discussion identified on Hacker News.',
            createdAt: hit.created_at || new Date().toISOString(),
          });
        }
      }

      if (redditRes.status === 'fulfilled' && redditRes.value.ok) {
        const redditData = await redditRes.value.json().catch(() => ({}));
        for (const item of redditData.data || []) {
          const title = item.title || 'Reddit Post';
          rawLeads.push({
            platform: 'reddit',
            author: item.author || 'reddit_user',
            title,
            text: item.selftext || title,
            url: item.permalink ? `https://www.reddit.com${item.permalink}` : (item.url || 'https://reddit.com'),
            score: 85,
            intentCategory: 'buy_intent',
            reason: 'Purchase intent phrase matched in public Reddit post.',
            createdAt: new Date(item.created_utc ? item.created_utc * 1000 : Date.now()).toISOString(),
          });
        }
      }
    }

    // 3. Auto-Enrichment & Database Persistence
    const savedLeads = [];

    for (const lead of rawLeads) {
      let enrichedEmail: string | null = null;
      let enrichedPhone: string | null = null;

      // Auto-enrichment trigger: If intentScore >= 80 and valid author name
      if (lead.score >= 80 && lead.author && !lead.author.includes('deleted') && !lead.author.includes('anonymous')) {
        try {
          const cleanName = lead.author.replace(/^[@u\/]/, '').trim();
          const parts = cleanName.split(/[\s_.]+/);
          const firstName = parts[0] || cleanName;
          const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

          // Attempt fast email enrichment via Prospeo/Tomba
          const enrichRes = await enrichContact({
            first_name: firstName,
            last_name: lastName,
            company_name: cleanName,
          });

          if (enrichRes?.workEmail?.value) {
            enrichedEmail = enrichRes.workEmail.value;
            console.log(`[Auto-Enrichment] Found verified email for ${lead.author}: ${enrichedEmail}`);
          }
          if (enrichRes?.phone?.value) {
            enrichedPhone = enrichRes.phone.value;
          }
        } catch (e) {
          // Graceful fallback: lead is still stored even if enrichment didn't return an email
        }
      }

      // Upsert into PostgreSQL
      const upserted = await (prisma as any).socialLead.upsert({
        where: { url: lead.url },
        update: {
          platform: lead.platform,
          title: lead.title,
          selftext: lead.text || null,
          author: lead.author || null,
          score: Math.round(lead.score),
          intentCategory: lead.intentCategory || 'buy_intent',
          reason: lead.reason || null,
          ...(enrichedEmail ? { enrichedEmail } : {}),
          ...(enrichedPhone ? { enrichedPhone } : {}),
        },
        create: {
          platform: lead.platform,
          title: lead.title,
          selftext: lead.text || null,
          url: lead.url,
          author: lead.author || null,
          score: Math.round(lead.score),
          intentCategory: lead.intentCategory || 'buy_intent',
          reason: lead.reason || null,
          enrichedEmail,
          enrichedPhone,
        },
      });

      savedLeads.push(upserted);
    }

    return NextResponse.json({
      success: true,
      keyword,
      count: savedLeads.length,
      leads: savedLeads,
    });
  } catch (error: any) {
    console.error('[Social Scrape Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Scraping failed' },
      { status: 500 }
    );
  }
}
