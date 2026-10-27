/**
 * LeadPilot B2B Social Search & HeyPastel-Style Discovery Regression Suite
 * 
 * Verifies query expansion, multi-source retrieval, provider failure isolation,
 * rate-limit diagnostic reporting, semantic intent classification, deduplication,
 * and live vs historical lead distinction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchExpansionService } from '@/lib/social/searchExpansionService';
import { HackerNewsConnector } from '@/lib/social/connectors/HackerNewsConnector';
import { RedditConnector } from '@/lib/social/connectors/RedditConnector';
import { RssFeedConnector } from '@/lib/social/connectors/RssFeedConnector';
import { MultiSourceSearchEngine } from '@/lib/social/multiSourceSearchEngine';
import { classifySignalIntent, IntentEvaluationInput } from '@/lib/ai/signalIntentClassifier';
import { prisma } from '@/lib/prisma';

describe('B2B Social Leads Search & HeyPastel Discovery Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Query expansion preserves original query
  it('preserves the original query and generates industry-relevant variants', async () => {
    const expansion = await SearchExpansionService.expandQuery({
      query: 'spare parts',
      maxVariants: 4,
    });

    expect(expansion.originalQuery).toBe('spare parts');
    expect(expansion.allQueries[0]).toBe('spare parts');
    expect(expansion.variants.length).toBeGreaterThan(0);
    expect(expansion.variants).toContain('spare parts supplier');
    expect(expansion.variants).toContain('replacement parts');
    expect(['LLM_EXPANSION', 'DETERMINISTIC_RULES']).toContain(expansion.expansionMethod);
  });

  // 2. Finds relevant posts even when the exact phrase is absent (via query expansion)
  it('finds relevant posts using expanded variants when the exact phrase is absent', async () => {
    // Mock HackerNewsConnector returning hits for the variant "replacement parts"
    vi.spyOn(HackerNewsConnector, 'search').mockImplementation(async (query: string) => {
      if (query === 'replacement parts' || query === 'spare parts supplier') {
        return {
          status: 'READY',
          signals: [
            {
              id: 'hn_99991',
              platform: 'hackernews',
              originalId: '99991',
              url: 'https://news.ycombinator.com/item?id=99991',
              author: 'plant_ops_lead',
              title: 'Need advice sourcing replacement industrial components for assembly line',
              text: 'Our primary vendor has 6 month lead times. Looking for alternative distributors who can deliver Siemens PLC modules and pneumatic replacement parts rapidly.',
              publishedAt: new Date().toISOString(),
              collectedAt: new Date().toISOString(),
            },
          ],
        };
      }
      return { status: 'READY', signals: [] };
    });

    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });

    const result = await MultiSourceSearchEngine.search({
      keyword: 'spare parts',
      includeHistorical: false,
    });

    expect(result.success).toBe(true);
    expect(result.leads.length).toBeGreaterThan(0);
    const lead = result.leads[0];
    expect(lead.title).toContain('replacement industrial components');
    expect(lead.score).toBeGreaterThanOrEqual(70);
  });

  // 3. Irrelevant uses of the phrase are filtered appropriately
  it('disqualifies seller self-promotion, job seekers, and spam even if phrase matches', async () => {
    const promoInput: IntentEvaluationInput = {
      title: 'Show HN: We sell spare parts and launched an online catalog',
      content: 'Check out our new tool and store for spare parts procurement. Use coupon CODE50 for 50% discount.',
      author: 'store_owner',
      platform: 'hackernews',
    };

    const promoResult = await classifySignalIntent(promoInput);
    expect(promoResult.isBuyer).toBe(false);
    expect(promoResult.score).toBeLessThanOrEqual(25);
    expect(promoResult.intentCategory).toBe('SELLER_PROMOTION');
    expect(promoResult.recommendedAction).toBe('DISMISS');

    const jobInput: IntentEvaluationInput = {
      title: 'Looking for a job in spare parts inventory management',
      content: 'Here is my CV and resume. Looking for work in warehouse logistics.',
      author: 'candidate_user',
      platform: 'reddit',
    };

    const jobResult = await classifySignalIntent(jobInput);
    expect(jobResult.isBuyer).toBe(false);
    expect(jobResult.score).toBeLessThanOrEqual(20);
    expect(jobResult.intentCategory).toBe('JOB_SEEKER');
  });

  // 4. One provider failing does not suppress successful results from other providers
  it('returns results from operational providers when another provider fails or is rate-limited', async () => {
    // Reddit is rate-limited (HTTP 429)
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({
      status: 'RATE_LIMITED',
      signals: [],
      error: 'Reddit API rate-limited (HTTP 429)',
    });

    // Hacker News succeeds with 2 leads
    vi.spyOn(HackerNewsConnector, 'search').mockResolvedValue({
      status: 'READY',
      signals: [
        {
          id: 'hn_123',
          platform: 'hackernews',
          originalId: '123',
          url: 'https://news.ycombinator.com/item?id=123',
          author: 'cto_buyer',
          title: 'Looking for recommendations for enterprise CRM tools',
          text: 'We need a CRM platform for 200 reps. What do you recommend?',
          publishedAt: new Date().toISOString(),
          collectedAt: new Date().toISOString(),
        },
      ],
    });

    // RSS succeeds with 1 lead
    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({
      status: 'READY',
      signals: [
        {
          id: 'rss_456',
          platform: 'rss',
          originalId: '456',
          url: 'https://b2bnews.example.com/item/456',
          author: 'procurement_daily',
          title: 'Automotive procurement managers seeking alternative parts suppliers',
          text: 'Tier 1 suppliers face shortages and are urgently seeking second-source replacement parts vendors.',
          publishedAt: new Date().toISOString(),
          collectedAt: new Date().toISOString(),
        },
      ],
    });

    const result = await MultiSourceSearchEngine.search({
      keyword: 'spare parts',
      includeHistorical: false,
    });

    expect(result.success).toBe(true);
    // Reddit failure was recorded without dropping HN or RSS results
    expect(result.sourceStatuses.reddit.status).toBe('RATE_LIMITED');
    expect(result.sourceStatuses.hackernews.status).toBe('SUCCESS');
    expect(result.sourceStatuses.rss.status).toBe('SUCCESS');
    expect(result.leads.length).toBe(2);
  });

  // 5. Provider rate limits and missing credentials are accurately represented
  it('distinguishes missing credentials (NOT_CONFIGURED) from live network rate limits', async () => {
    vi.spyOn(HackerNewsConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({
      status: 'RATE_LIMITED',
      signals: [],
      error: 'Reddit API rate-limited (HTTP 429)',
    });

    const result = await MultiSourceSearchEngine.search({
      keyword: 'spare parts',
      includeHistorical: false,
    });

    // Twitter is NOT_CONFIGURED
    expect(result.sourceStatuses.twitter.status).toBe('NOT_CONFIGURED');
    expect(result.sourceStatuses.twitter.message).toContain('TWITTER_BEARER_TOKEN');
    // Reddit is RATE_LIMITED
    expect(result.sourceStatuses.reddit.status).toBe('RATE_LIMITED');
  });

  // 6. Valid zero-result responses differ from network errors
  it('returns a structured empty result with explanation rather than a fatal error', async () => {
    vi.spyOn(HackerNewsConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });

    // Mock Prisma returning 0 records
    vi.spyOn((prisma as any).socialLead, 'findMany').mockResolvedValue([]);

    const result = await MultiSourceSearchEngine.search({
      keyword: 'xyznonexistentterm99999',
      includeHistorical: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalFound).toBe(0);
    expect(result.leads).toHaveLength(0);
    expect(result.emptyReason).toContain('No posts found across');
  });

  // 7. Duplicate posts are deduplicated by canonical URL
  it('deduplicates identical posts across multiple expanded query passes', async () => {
    const identicalUrl = 'https://news.ycombinator.com/item?id=88888';

    vi.spyOn(HackerNewsConnector, 'search').mockResolvedValue({
      status: 'READY',
      signals: [
        {
          id: 'hn_88888',
          platform: 'hackernews',
          originalId: '88888',
          url: identicalUrl,
          author: 'engineer_one',
          title: 'Looking for a reliable parts distributor',
          text: 'Where do people buy replacement sensors and stepper motors in bulk?',
          publishedAt: new Date().toISOString(),
          collectedAt: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });

    const result = await MultiSourceSearchEngine.search({
      keyword: 'spare parts',
      includeHistorical: false,
    });

    const occurrences = result.leads.filter((l) => l.url === identicalUrl);
    expect(occurrences).toHaveLength(1);
  });

  // 8. Intent classification uses real post evidence and populates reason
  it('grounds intent score in real post evidence with category breakdown', async () => {
    const input: IntentEvaluationInput = {
      title: 'Cancelling our contract with existing parts vendor due to quality defects',
      content: 'We need an alternative supplier for CNC precision parts immediately. Budget is $80k/quarter.',
      author: 'manufacturing_dir',
      platform: 'hackernews',
    };

    const classification = await classifySignalIntent(input);
    expect(classification.isBuyer).toBe(true);
    expect(classification.score).toBeGreaterThanOrEqual(80);
    expect(classification.intentCategory).toBe('COMPETITOR_SWITCH');
    expect(classification.urgency).toBe('HIGH');
    expect(classification.reason).toBeTruthy();
    expect(classification.evidenceSnippet).toBeTruthy();
  });

  // 9. Historical results remain distinguishable from live results
  it('labels stored database records as historical while fresh signals are live', async () => {
    vi.spyOn(HackerNewsConnector, 'search').mockResolvedValue({
      status: 'READY',
      signals: [
        {
          id: 'hn_live_1',
          platform: 'hackernews',
          originalId: 'live_1',
          url: 'https://news.ycombinator.com/item?id=live_1',
          author: 'live_user',
          title: 'Live query hit for replacement parts',
          text: 'Need replacement industrial belts.',
          publishedAt: new Date().toISOString(),
          collectedAt: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(RssFeedConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });
    vi.spyOn(RedditConnector, 'search').mockResolvedValue({ status: 'READY', signals: [] });

    // Mock Prisma returning 1 historical lead
    vi.spyOn((prisma as any).socialLead, 'findMany').mockResolvedValue([
      {
        id: 'hist_1',
        platform: 'reddit',
        title: 'Historical post about parts sourcing',
        selftext: 'Looking for parts distributors from last month.',
        url: 'https://reddit.com/r/machining/comments/hist_1',
        author: 'hist_user',
        score: 85,
        intentCategory: 'RECOMMENDATION_REQUEST',
        reason: 'Explicit request for parts vendor.',
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      },
    ]);

    const result = await MultiSourceSearchEngine.search({
      keyword: 'spare parts',
      includeHistorical: true,
    });

    const liveLead = result.leads.find((l) => l.url.includes('live_1'));
    const histLead = result.leads.find((l) => l.url.includes('hist_1'));

    expect(liveLead?.isHistorical).toBe(false);
    expect(histLead?.isHistorical).toBe(true);
  });
});
