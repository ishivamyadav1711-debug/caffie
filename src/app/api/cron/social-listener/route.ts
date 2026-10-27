import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { classifySignalIntent, IntentEvaluationInput } from '@/lib/ai/signalIntentClassifier';
import { RssFeedConnector } from '@/lib/social/connectors/RssFeedConnector';
import { XTwitterConnector } from '@/lib/social/connectors/XTwitterConnector';
import { HackerNewsConnector } from '@/lib/social/connectors/HackerNewsConnector';
import { RedditConnector } from '@/lib/social/connectors/RedditConnector';
import { DurableTaskQueue } from '@/lib/queue/DurableTaskQueue';
import { enrichContact } from '@/lib/enrichment';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  console.log('[Cron: Social Listener] Starting automated buying-intent ingestion cycle...');

  // 1. Recover any orphaned jobs from past process restarts
  const recoveredCount = await DurableTaskQueue.recoverOrphanedJobs(10);

  // 2. Enqueue and claim a Durable Job for this run
  const jobId = await DurableTaskQueue.enqueue({
    type: 'SOCIAL_LISTENER_INGESTION',
    payload: { trigger: 'cron', executedAt: new Date().toISOString() },
  });

  const job = await DurableTaskQueue.claimNextJob();

  const searchQueries = [
    'looking for CRM',
    'alternative to HubSpot',
    'software recommendation',
    'sales intelligence tool',
  ];

  let totalDiscovered = 0;
  let totalProcessed = 0;
  let totalQualified = 0;
  const newQualifiedLeads = [];

  try {
    for (const query of searchQueries) {
      const rawPosts: Array<{ platform: string; author: string; title: string; text: string; url: string }> = [];

      // A. Hacker News Algolia (HTTPS with stories & comments)
      try {
        const hnRes = await HackerNewsConnector.search(query, { limit: 3 });
        for (const sig of hnRes.signals) {
          rawPosts.push({
            platform: 'hackernews',
            author: sig.author,
            title: sig.title,
            text: sig.text,
            url: sig.url,
          });
        }
      } catch (e: any) {
        console.warn(`[Cron Listener] HN search warning: ${e.message}`);
      }

      // B. Reddit Public Connector
      try {
        const redditRes = await RedditConnector.search(query, { limit: 3 });
        for (const sig of redditRes.signals) {
          rawPosts.push({
            platform: 'reddit',
            author: sig.author,
            title: sig.title,
            text: sig.text,
            url: sig.url,
          });
        }
      } catch (e: any) {
        console.warn(`[Cron Listener] Reddit search warning: ${e.message}`);
      }

      // C. RSS Feeds
      try {
        const rssSignals = await RssFeedConnector.searchFeeds(query, 2);
        for (const sig of rssSignals) {
          rawPosts.push({
            platform: 'rss',
            author: sig.author,
            title: sig.title,
            text: sig.text,
            url: sig.url,
          });
        }
      } catch (e: any) {
        console.warn(`[Cron Listener] RSS feed search warning: ${e.message}`);
      }

      // D. X / Twitter API if configured
      if (XTwitterConnector.getBearerToken()) {
        try {
          const xRes = await XTwitterConnector.searchTweets(query, { limit: 3 });
          for (const sig of xRes.signals) {
            rawPosts.push({
              platform: 'twitter',
              author: sig.author,
              title: sig.title,
              text: sig.text,
              url: sig.url,
            });
          }
        } catch (e: any) {
          console.warn(`[Cron Listener] X API search warning: ${e.message}`);
        }
      }

      totalDiscovered += rawPosts.length;

      // Deduplicate against existing database records
      for (const post of rawPosts) {
        const existing = await (prisma as any).socialLead.findUnique({
          where: { url: post.url },
        });

        if (existing) continue; // Deduplication guarantee

        totalProcessed++;

        const evalResult = await classifySignalIntent({
          title: post.title,
          content: post.text,
          author: post.author,
          platform: post.platform,
        });

        const score = evalResult.score;
        const isQualified = evalResult.isBuyer;

        let enrichedEmail: string | null = null;
        let enrichedProvider: string | null = null;

        // Auto-enrich high-scoring qualified signals
        if (score >= 80 && isQualified && post.author && !post.author.includes('deleted')) {
          totalQualified++;
          try {
            const cleanAuthor = post.author.replace(/^[@u\/]/, '').trim();
            const parts = cleanAuthor.split(/[\s_.-]+/);
            const enrichRes = await enrichContact({
              first_name: parts[0] || cleanAuthor,
              last_name: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
              company_name: cleanAuthor,
            });
            if (enrichRes?.workEmail?.value) {
              enrichedEmail = enrichRes.workEmail.value;
              enrichedProvider = enrichRes.workEmail.provider || 'waterfall';
            }
          } catch {}
        }

        const reason = evalResult.reason;

        const saved = await (prisma as any).socialLead.create({
          data: {
            platform: post.platform,
            title: post.title,
            selftext: post.text || null,
            url: post.url,
            author: post.author || null,
            score,
            intentCategory: evalResult.intentCategory,
            reason,
            enrichedEmail,
            enrichedProvider,
          },
        });
        if (isQualified && score >= 75) {
          newQualifiedLeads.push(saved);
        }
      }
    }

    if (job) {
      await DurableTaskQueue.markCompleted(job.id, {
        discovered: totalDiscovered,
        processed: totalProcessed,
        qualified: totalQualified,
      });
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startTime,
      stats: {
        recoveredJobs: recoveredCount,
        totalDiscovered,
        totalProcessed,
        totalQualified,
        newHighIntentLeadsSaved: newQualifiedLeads.length,
      },
      sampleQualified: newQualifiedLeads.slice(0, 5),
    });
  } catch (error: any) {
    console.error('[Cron: Social Listener Error]:', error);
    if (job) {
      await DurableTaskQueue.markFailed(job.id, error.message);
    }
    return NextResponse.json(
      { success: false, error: error.message || 'Ingestion cycle failed' },
      { status: 500 }
    );
  }
}
