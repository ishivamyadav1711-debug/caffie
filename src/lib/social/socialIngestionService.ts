import { prisma } from '@/lib/prisma';
import {
  SocialSignalRecord,
  SocialConnectorResult,
  ConnectorDiagnostic,
  ConnectorFetchOptions,
  SocialPlatform,
} from './types';
import { redditConnector } from './connectors/redditConnector';
import { hackerNewsConnector } from './connectors/hackerNewsConnector';
import { publicRssConnector } from './connectors/rssConnector';

export interface IngestionOptions extends ConnectorFetchOptions {
  platforms?: SocialPlatform[];
  saveToDatabase?: boolean;
}

export interface IngestionReport {
  timestamp: string;
  query: string;
  totalCollected: number;
  newlyIngested: number;
  duplicatesSkipped: number;
  records: SocialSignalRecord[];
  diagnostics: Record<string, ConnectorDiagnostic>;
}

export class SocialIngestionService {
  private static instance: SocialIngestionService;

  // In-memory set for rapid deduplication between polling loops
  private seenHashes = new Set<string>();

  private constructor() {}

  public static getInstance(): SocialIngestionService {
    if (!SocialIngestionService.instance) {
      SocialIngestionService.instance = new SocialIngestionService();
    }
    return SocialIngestionService.instance;
  }

  /**
   * Ingests real social signals from configured, permitted public connectors.
   */
  public async ingestSignals(options: IngestionOptions = {}): Promise<IngestionReport> {
    const timestamp = new Date().toISOString();
    const query = (options.query || 'looking for agency OR need website OR need crm').trim();
    const limit = options.limit || 10;
    const saveToDb = options.saveToDatabase !== false;

    const requestedPlatforms = options.platforms || ['reddit', 'hackernews', 'rss'];
    const diagnostics: Record<string, ConnectorDiagnostic> = {};
    const collectedRecords: SocialSignalRecord[] = [];

    // 1. Concurrent collection across requested sources with isolated failure boundaries
    const tasks: Promise<SocialConnectorResult>[] = [];

    if (requestedPlatforms.includes('reddit')) {
      tasks.push(redditConnector.collect({ query, limit, timeoutMs: options.timeoutMs }));
    }

    if (requestedPlatforms.includes('hackernews')) {
      tasks.push(hackerNewsConnector.collect({ query, limit, timeoutMs: options.timeoutMs }));
    }

    if (requestedPlatforms.includes('rss')) {
      tasks.push(publicRssConnector.collect({ limit, timeoutMs: options.timeoutMs }));
    }

    const results = await Promise.allSettled(tasks);

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const { records, diagnostic } = res.value;
        diagnostics[diagnostic.platform] = diagnostic;
        collectedRecords.push(...records);
      }
    }

    // 2. Strict Deduplication by content_hash and source_url
    const uniqueRecords: SocialSignalRecord[] = [];
    let duplicatesSkipped = 0;

    for (const record of collectedRecords) {
      if (this.seenHashes.has(record.content_hash)) {
        duplicatesSkipped++;
        continue;
      }
      this.seenHashes.add(record.content_hash);
      uniqueRecords.push(record);
    }

    // 3. Database Persistence (Prisma SocialSignal)
    let newlyIngested = 0;

    if (saveToDb && uniqueRecords.length > 0) {
      for (const record of uniqueRecords) {
        try {
          await (prisma as any).socialSignal.upsert({
            where: {
              sourcePlatform_sourceRecordId: {
                sourcePlatform: record.source_platform,
                sourceRecordId: record.source_record_id,
              },
            },
            update: {
              sourceUrl: record.source_url,
              authorHandle: record.author_handle,
              publicationTimestamp: record.publication_timestamp
                ? new Date(record.publication_timestamp)
                : null,
              retrievedAt: new Date(record.retrieved_at),
              title: record.title,
              contentText: record.content_text,
              contentHash: record.content_hash,
              accessMethod: record.access_method,
              collectionStatus: record.collection_status,
              metadata: record.metadata ? JSON.stringify(record.metadata) : undefined,
            },
            create: {
              sourcePlatform: record.source_platform,
              sourceRecordId: record.source_record_id,
              sourceUrl: record.source_url,
              authorHandle: record.author_handle,
              publicationTimestamp: record.publication_timestamp
                ? new Date(record.publication_timestamp)
                : null,
              retrievedAt: new Date(record.retrieved_at),
              title: record.title,
              contentText: record.content_text,
              contentHash: record.content_hash,
              accessMethod: record.access_method,
              collectionStatus: record.collection_status,
              metadata: record.metadata ? JSON.stringify(record.metadata) : undefined,
            },
          });
          newlyIngested++;
        } catch (dbErr: any) {
          // If already exists or transient conflict, count as skipped
          if (dbErr.code === 'P2002') {
            duplicatesSkipped++;
          } else {
            console.warn(`[SocialIngestion] DB upsert notice: ${dbErr.message}`);
          }
        }
      }
    } else {
      newlyIngested = uniqueRecords.length;
    }

    return {
      timestamp,
      query,
      totalCollected: collectedRecords.length,
      newlyIngested,
      duplicatesSkipped,
      records: uniqueRecords,
      diagnostics,
    };
  }

  /**
   * Retrieves stored social signals from database.
   */
  public async getStoredSignals(filters: {
    platform?: string;
    limit?: number;
    since?: string;
  } = {}): Promise<SocialSignalRecord[]> {
    const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
    const where: any = {};

    if (filters.platform && filters.platform !== 'all') {
      where.sourcePlatform = filters.platform.toLowerCase();
    }

    if (filters.since) {
      const sinceDate = new Date(filters.since);
      if (!isNaN(sinceDate.getTime())) {
        where.publicationTimestamp = { gte: sinceDate };
      }
    }

    try {
      const rows = await (prisma as any).socialSignal.findMany({
        where,
        orderBy: [{ publicationTimestamp: 'desc' }, { retrievedAt: 'desc' }],
        take: limit,
      });

      return rows.map((r: any) => ({
        source_platform: r.sourcePlatform,
        source_record_id: r.sourceRecordId,
        source_url: r.sourceUrl,
        author_handle: r.authorHandle,
        publication_timestamp: r.publicationTimestamp ? r.publicationTimestamp.toISOString() : null,
        retrieved_at: r.retrievedAt.toISOString(),
        title: r.title,
        content_text: r.contentText,
        content_hash: r.contentHash,
        access_method: r.accessMethod,
        collection_status: r.collectionStatus,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      }));
    } catch (err: any) {
      console.warn(`[SocialIngestion] Failed to read from DB: ${err.message}`);
      return [];
    }
  }

  public clearMemoryCache(): void {
    this.seenHashes.clear();
  }
}

export const socialIngestionService = SocialIngestionService.getInstance();

