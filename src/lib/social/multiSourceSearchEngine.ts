/**
 * Multi-Source Buying-Intent Search Engine
 * 
 * Orchestrates multi-platform social signal retrieval (Hacker News, RSS/Atom, Reddit, X)
 * with query expansion, intent classification, and database synchronization.
 * Inspired by SignalPipe and Agent Reach architectures.
 */

import { prisma } from '@/lib/prisma';
import { SocialSignal, ConnectorStatus } from './types';
import { SearchExpansionService, ExpandedSearchResult } from './searchExpansionService';
import { HackerNewsConnector } from './connectors/HackerNewsConnector';
import { RssFeedConnector } from './connectors/RssFeedConnector';
import { RedditConnector } from './connectors/RedditConnector';
import { XTwitterConnector } from './connectors/XTwitterConnector';
import { classifySignalIntent, IntentEvaluationInput } from '@/lib/ai/signalIntentClassifier';
import { enrichContact } from '@/lib/enrichment';

export interface SourceDiagnostic {
  platform: string;
  displayName: string;
  status: 'SUCCESS' | 'RATE_LIMITED' | 'AUTH_FAILED' | 'NOT_CONFIGURED' | 'ERROR' | 'EMPTY';
  count: number;
  message?: string;
  error?: string | null;
}

export interface MultiSourceSearchInput {
  keyword: string;
  limitPerSource?: number;
  minScore?: number;
  includeHistorical?: boolean;
}

export interface ScoredSocialLead {
  id: string;
  platform: string;
  title: string;
  selftext?: string | null;
  url: string;
  author?: string | null;
  company?: string | null;
  score: number;
  intentCategory?: string | null;
  reason?: string | null;
  enrichedEmail?: string | null;
  enrichedProvider?: string | null;
  enrichedPhone?: string | null;
  createdAt: string;
  isHistorical?: boolean;
  matchedQuery?: string;
  evidenceSnippet?: string;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction?: string;
}

export interface MultiSourceSearchResult {
  success: boolean;
  query: string;
  expandedQueries: string[];
  expansionMethod: 'LLM_EXPANSION' | 'DETERMINISTIC_RULES';
  llmProviderUsed?: string;
  sourceStatuses: Record<string, SourceDiagnostic>;
  totalFound: number;
  liveCount: number;
  historicalCount: number;
  leads: ScoredSocialLead[];
  emptyReason?: string;
}

export class MultiSourceSearchEngine {
  /**
   * Executes a robust multi-source buying-intent search
   */
  public static async search(input: MultiSourceSearchInput): Promise<MultiSourceSearchResult> {
    const rawKeyword = (input.keyword || '').trim();
    if (!rawKeyword) {
      return {
        success: false,
        query: '',
        expandedQueries: [],
        expansionMethod: 'DETERMINISTIC_RULES',
        sourceStatuses: {},
        totalFound: 0,
        liveCount: 0,
        historicalCount: 0,
        leads: [],
        emptyReason: 'Search query is empty.',
      };
    }

    // 1. Expand query using deterministic rules or LLM
    const expansion: ExpandedSearchResult = await SearchExpansionService.expandQuery({
      query: rawKeyword,
      maxVariants: 4,
    });

    const queriesToSearch = expansion.allQueries;
    console.log(`[MultiSource Search] Executing multi-source search for "${rawKeyword}" with ${queriesToSearch.length} queries: [${queriesToSearch.join(', ')}]`);

    // 2. Track source diagnostics
    const sourceStatuses: Record<string, SourceDiagnostic> = {
      hackernews: {
        platform: 'hackernews',
        displayName: 'Hacker News (Algolia API)',
        status: 'EMPTY',
        count: 0,
      },
      rss: {
        platform: 'rss',
        displayName: 'RSS / Topic Feeds',
        status: 'EMPTY',
        count: 0,
      },
      reddit: {
        platform: 'reddit',
        displayName: 'Reddit (PullPush Public API)',
        status: 'EMPTY',
        count: 0,
      },
      twitter: {
        platform: 'twitter',
        displayName: 'X / Twitter (Official API v2)',
        status: 'NOT_CONFIGURED',
        count: 0,
        message: 'X API credentials not configured. Set TWITTER_BEARER_TOKEN to enable live X search.',
      },
      database: {
        platform: 'database',
        displayName: 'Historical Stored Leads',
        status: 'SUCCESS',
        count: 0,
      },
    };

    const rawSignals: Array<SocialSignal & { matchedQuery: string }> = [];
    const seenUrls = new Set<string>();

    // 3. Query live providers across expanded queries
    // A. Hacker News Search (Primary tech & discussion engine)
    for (const q of queriesToSearch.slice(0, 3)) {
      try {
        const hnRes = await HackerNewsConnector.search(q, { limit: 8 });
        if (hnRes.status === 'READY') {
          sourceStatuses.hackernews.status = 'SUCCESS';
          for (const sig of hnRes.signals) {
            if (!seenUrls.has(sig.url)) {
              seenUrls.add(sig.url);
              rawSignals.push({ ...sig, matchedQuery: q });
              sourceStatuses.hackernews.count++;
            }
          }
        } else {
          sourceStatuses.hackernews.status = hnRes.status as any;
          sourceStatuses.hackernews.error = hnRes.error;
        }
      } catch (err: any) {
        sourceStatuses.hackernews.status = 'ERROR';
        sourceStatuses.hackernews.error = err.message;
      }
    }

    // B. RSS & Atom Topic Feeds (Dynamic real-time B2B Google News and industry feeds)
    for (const q of queriesToSearch.slice(0, 3)) {
      try {
        const rssRes = await RssFeedConnector.search(q, { limit: 6 });
        if (rssRes.status === 'READY') {
          sourceStatuses.rss.status = 'SUCCESS';
          for (const sig of rssRes.signals) {
            if (!seenUrls.has(sig.url)) {
              seenUrls.add(sig.url);
              rawSignals.push({ ...sig, matchedQuery: q });
              sourceStatuses.rss.count++;
            }
          }
        } else {
          sourceStatuses.rss.status = rssRes.status as any;
          sourceStatuses.rss.error = rssRes.error;
        }
      } catch (err: any) {
        sourceStatuses.rss.status = 'ERROR';
        sourceStatuses.rss.error = err.message;
      }
    }

    // C. Reddit Public PullPush Connector
    try {
      const redditRes = await RedditConnector.search(rawKeyword, { limit: 5 });
      if (redditRes.status === 'READY') {
        sourceStatuses.reddit.status = 'SUCCESS';
        for (const sig of redditRes.signals) {
          if (!seenUrls.has(sig.url)) {
            seenUrls.add(sig.url);
            rawSignals.push({ ...sig, matchedQuery: rawKeyword });
            sourceStatuses.reddit.count++;
          }
        }
      } else {
        sourceStatuses.reddit.status = redditRes.status as any;
        sourceStatuses.reddit.error = redditRes.error;
        sourceStatuses.reddit.message = redditRes.error;
      }
    } catch (err: any) {
      sourceStatuses.reddit.status = 'ERROR';
      sourceStatuses.reddit.error = err.message;
    }

    // D. X / Twitter Connector (if configured)
    if (XTwitterConnector.getBearerToken()) {
      try {
        const xRes = await XTwitterConnector.searchTweets(rawKeyword, { limit: 5 });
        if (xRes.signals.length > 0) {
          sourceStatuses.twitter.status = 'SUCCESS';
          for (const sig of xRes.signals) {
            if (!seenUrls.has(sig.url)) {
              seenUrls.add(sig.url);
              rawSignals.push({ ...sig, matchedQuery: rawKeyword });
              sourceStatuses.twitter.count++;
            }
          }
        }
      } catch (err: any) {
        sourceStatuses.twitter.status = 'ERROR';
        sourceStatuses.twitter.error = err.message;
      }
    }

    console.log(`[MultiSource Search] Collected ${rawSignals.length} raw signals from live providers.`);

    // 4. Intent Scoring & Deduplication of Live Signals
    const scoredLiveLeads: ScoredSocialLead[] = [];

    for (const sig of rawSignals) {
      try {
        const signalInput: IntentEvaluationInput = {
          title: sig.title,
          content: sig.text,
          author: sig.author,
          platform: sig.platform,
        };

        const evalResult = await classifySignalIntent(signalInput);
        const score = evalResult.score;

        let enrichedEmail: string | null = null;
        let enrichedProvider: string | null = null;

        // Auto-enrich high intent buyers in the background without blocking search response
        if (score >= 80 && evalResult.isBuyer && sig.author && sig.author !== 'Anonymous') {
          const cleanAuthor = sig.author.replace(/^[@u\/]/, '').trim();
          const nameParts = cleanAuthor.split(/[\s_.-]+/);
          const firstName = nameParts[0] || 'Member';
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

          enrichContact({
            first_name: firstName,
            last_name: lastName,
            company_domain: `${cleanAuthor.toLowerCase()}.com`,
            company_name: cleanAuthor,
          })
            .then(async (enrichRes) => {
              if (enrichRes?.workEmail?.value) {
                await (prisma as any).socialLead
                  .update({
                    where: { url: sig.url },
                    data: {
                      enrichedEmail: enrichRes.workEmail.value,
                      enrichedProvider: enrichRes.workEmail.provider || 'waterfall',
                    },
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }

        // Upsert into persistent database
        let savedLeadId = sig.id;
        try {
          const upserted = await (prisma as any).socialLead.upsert({
            where: { url: sig.url },
            update: {
              platform: sig.platform,
              title: sig.title,
              selftext: sig.text || null,
              author: sig.author || null,
              score,
              intentCategory: evalResult.intentCategory,
              reason: evalResult.reason,
              ...(enrichedEmail ? { enrichedEmail, enrichedProvider } : {}),
            },
            create: {
              platform: sig.platform,
              title: sig.title,
              selftext: sig.text || null,
              url: sig.url,
              author: sig.author || null,
              score,
              intentCategory: evalResult.intentCategory,
              reason: evalResult.reason,
              enrichedEmail: enrichedEmail || null,
              enrichedProvider: enrichedProvider || null,
            },
          });
          if (upserted?.id) {
            savedLeadId = upserted.id;
          }
        } catch (dbErr: any) {
          console.warn(`[MultiSource Search] Database save notice: ${dbErr.message}`);
        }

        scoredLiveLeads.push({
          id: savedLeadId,
          platform: sig.platform,
          title: sig.title,
          selftext: sig.text,
          url: sig.url,
          author: sig.author,
          score,
          intentCategory: evalResult.intentCategory,
          reason: evalResult.reason,
          enrichedEmail,
          enrichedProvider,
          createdAt: sig.publishedAt || new Date().toISOString(),
          isHistorical: false,
          matchedQuery: sig.matchedQuery,
          evidenceSnippet: evalResult.evidenceSnippet,
          urgency: evalResult.urgency,
          recommendedAction: evalResult.recommendedAction,
        });
      } catch (scoringErr: any) {
        console.warn(`[MultiSource Search] Error scoring signal: ${scoringErr.message}`);
      }
    }

    // 5. Query Historical Stored Database Leads matching the query or variants
    const historicalLeads: ScoredSocialLead[] = [];
    if (input.includeHistorical !== false) {
      try {
        const queryTerms = [rawKeyword, ...expansion.variants];
        const orConditions = queryTerms.flatMap((term) => [
          { title: { contains: term, mode: 'insensitive' } },
          { selftext: { contains: term, mode: 'insensitive' } },
          { reason: { contains: term, mode: 'insensitive' } },
        ]);

        const dbMatches = await (prisma as any).socialLead.findMany({
          where: {
            OR: orConditions,
          },
          orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
          take: 15,
        });

        sourceStatuses.database.count = dbMatches.length;

        for (const item of dbMatches) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            historicalLeads.push({
              id: item.id,
              platform: item.platform,
              title: item.title,
              selftext: item.selftext,
              url: item.url,
              author: item.author,
              company: item.company,
              score: item.score,
              intentCategory: item.intentCategory,
              reason: item.reason,
              enrichedEmail: item.enrichedEmail,
              enrichedProvider: item.enrichedProvider,
              enrichedPhone: item.enrichedPhone,
              createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
              isHistorical: true,
              matchedQuery: rawKeyword,
            });
          }
        }
      } catch (dbErr: any) {
        console.warn(`[MultiSource Search] Historical search notice: ${dbErr.message}`);
      }
    }

    // 6. Merge live + historical leads, sorted by score and relevance
    const mergedLeads = [...scoredLiveLeads, ...historicalLeads].sort((a, b) => {
      // Prioritize high-intent score
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Then prioritize live leads over historical
      if (a.isHistorical !== b.isHistorical) {
        return a.isHistorical ? 1 : -1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const totalFound = mergedLeads.length;
    let emptyReason: string | undefined;

    if (totalFound === 0) {
      const activeSources = Object.values(sourceStatuses).filter((s) => s.status === 'SUCCESS').map((s) => s.displayName);
      const failedSources = Object.values(sourceStatuses).filter((s) => s.status === 'RATE_LIMITED' || s.status === 'ERROR' || s.status === 'AUTH_FAILED').map((s) => `${s.displayName} (${s.status})`);
      
      emptyReason = `No posts found across ${queriesToSearch.length} search variations. Query executed on: ${activeSources.join(', ') || 'None'}.${failedSources.length > 0 ? ` Note: ${failedSources.join(', ')} were unavailable.` : ''}`;
    }

    return {
      success: true,
      query: rawKeyword,
      expandedQueries: expansion.variants,
      expansionMethod: expansion.expansionMethod,
      llmProviderUsed: expansion.llmProviderUsed,
      sourceStatuses,
      totalFound,
      liveCount: scoredLiveLeads.length,
      historicalCount: historicalLeads.length,
      leads: mergedLeads,
      emptyReason,
    };
  }
}
