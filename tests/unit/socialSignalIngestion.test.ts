import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createContentHash, normalizeContent, normalizeUtcDate, sanitizeString } from '@/lib/social/hashUtils';
import { RedditConnector } from '@/lib/social/connectors/redditConnector';
import { HackerNewsConnector } from '@/lib/social/connectors/hackerNewsConnector';
import { PublicRssConnector, isSafePublicUrl, DEFAULT_FEED_REGISTRY } from '@/lib/social/connectors/rssConnector';
import { SocialIngestionService } from '@/lib/social/socialIngestionService';
import { SocialSignalRecord } from '@/lib/social/types';
import { GET, POST } from '@/app/api/social-signals/route';
import { prisma } from '@/lib/prisma';

describe('Phase 1 & Phase 1.1: Social Signal Ingestion & Hardening Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Normalization & Deterministic Hashing', () => {
    it('normalizes content by collapsing whitespace, carriage returns, and trimming', () => {
      const raw = '  Looking   for a \r\n web \t developer   urgently! \0  ';
      const normalized = normalizeContent(raw);
      expect(normalized).toBe('Looking for a web developer urgently!');
    });

    it('generates deterministic SHA-256 content hashes for identical payloads', () => {
      const hash1 = createContentHash('reddit', 'post_123', 'Need a website redesign for clinic');
      const hash2 = createContentHash('reddit', 'post_123', 'Need  a  website  redesign  for  clinic ');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces distinct hashes for different platforms or record IDs', () => {
      const hashReddit = createContentHash('reddit', '123', 'Sample content text');
      const hashHN = createContentHash('hackernews', '123', 'Sample content text');
      const hashOtherId = createContentHash('reddit', '456', 'Sample content text');

      expect(hashReddit).not.toBe(hashHN);
      expect(hashReddit).not.toBe(hashOtherId);
    });

    it('normalizes unix timestamps (seconds, ms, ISO strings) to strict UTC ISO-8601', () => {
      const fromSec = normalizeUtcDate(1700000000);
      expect(fromSec).toBe('2023-11-14T22:13:20.000Z');

      const fromMs = normalizeUtcDate(1700000000000);
      expect(fromMs).toBe('2023-11-14T22:13:20.000Z');

      const fromIso = normalizeUtcDate('2026-10-27T12:00:00Z');
      expect(fromIso).toBe('2026-10-27T12:00:00.000Z');

      expect(normalizeUtcDate('invalid-date')).toBeNull();
      expect(normalizeUtcDate(null)).toBeNull();
    });

    it('sanitizes strings against null bytes and enforces length constraints', () => {
      const dirty = 'Safe Title\0With Hidden Bytes';
      expect(sanitizeString(dirty)).toBe('Safe TitleWith Hidden Bytes');
      expect(sanitizeString('a'.repeat(200), 50)).toHaveLength(50);
    });
  });

  describe('2. Hardened Reddit Connector', () => {
    it('successfully parses valid Reddit public JSON responses into SocialSignalRecord array', async () => {
      const mockRedditResponse = {
        data: {
          children: [
            {
              data: {
                id: '1x4x2qo',
                title: 'Need a Fullstack Developer for Web App',
                selftext: 'Looking to build an MVP for automated CRM tracking.',
                author: 'founder_john',
                created_utc: 1729800000,
                permalink: '/r/forhire/comments/1x4x2qo/need_developer/',
                subreddit_name_prefixed: 'r/forhire',
                score: 15,
                num_comments: 4,
              },
            },
          ],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockRedditResponse,
      } as any);

      const connector = new RedditConnector();
      const result = await connector.collect({ query: 'need developer', limit: 5 });

      expect(result.diagnostic.status).toBe('SUCCESS');
      expect(result.diagnostic.accessMethod).toBe('public_api');
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      expect(record.source_platform).toBe('reddit');
      expect(record.source_record_id).toBe('1x4x2qo');
      expect(record.author_handle).toBe('u/founder_john');
      expect(record.title).toBe('Need a Fullstack Developer for Web App');
      expect(record.content_hash).toBeDefined();
      expect(record.access_method).toBe('public_api');
      expect(record.collection_status).toBe('SUCCESS');
    });

    it('falls back to PullPush archive API when Reddit returns 429 Rate Limit', async () => {
      const mockPullPushResponse = {
        data: [
          {
            id: 'archive_post_999',
            title: 'Hiring Agency for Landing Page',
            selftext: 'Need someone to redesign our SaaS site.',
            author: 'archive_user',
            created_utc: 1729700000,
            permalink: 'https://reddit.com/r/startups/comments/archive_post_999',
            subreddit: 'startups',
            score: 8,
          },
        ],
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ status: 429, ok: false } as any)
        .mockResolvedValueOnce({ status: 429, ok: false } as any)
        .mockResolvedValueOnce({ status: 429, ok: false } as any)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => mockPullPushResponse,
        } as any);

      const connector = new RedditConnector();
      const result = await connector.collect({ query: 'hiring agency' });

      expect(result.diagnostic.status).toBe('SUCCESS');
      expect(result.diagnostic.accessMethod).toBe('public_archive');
      expect(result.records).toHaveLength(1);
      expect(result.records[0].source_record_id).toBe('archive_post_999');
      expect(result.records[0].access_method).toBe('public_archive');
    });

    it('returns empty records array with explicit FAILED diagnostic on total outage (Zero Synthetic Leads)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network connection timeout'));

      const connector = new RedditConnector();
      const result = await connector.collect({ query: 'nonexistent query' });

      expect(result.records).toHaveLength(0);
      expect(result.diagnostic.status).toBe('FAILED');
      expect(result.diagnostic.error).toContain('timeout');
    });
  });

  describe('3. Hardened Hacker News Quality & Algolia Connector', () => {
    it('parses Algolia search response and skips dead/deleted items by tags', async () => {
      const mockHnResponse = {
        hits: [
          {
            objectID: '4190001',
            title: 'Ask HN: Who is looking for freelance frontend work?',
            story_text: 'Post your details if you are looking for clients this month.',
            author: 'dang',
            created_at_i: 1729850000,
            url: null,
            points: 120,
            num_comments: 85,
            _tags: ['story', 'ask_hn'],
          },
          {
            objectID: '4190002',
            title: 'Some normal title',
            story_text: null,
            author: null,
            _tags: ['story', 'deleted'],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockHnResponse,
      } as any);

      const connector = new HackerNewsConnector();
      const result = await connector.collect({ query: 'freelance work' });

      expect(result.diagnostic.status).toBe('SUCCESS');
      expect(result.records).toHaveLength(1);

      const item = result.records[0];
      expect(item.source_platform).toBe('hackernews');
      expect(item.source_record_id).toBe('4190001');
      expect(item.author_handle).toBe('dang');
      expect(item.source_url).toBe('https://news.ycombinator.com/item?id=4190001');
      expect(item.metadata?.points).toBe(120);
    });

    it('rejects items with titles starting with [dead] or [deleted] case-insensitively', async () => {
      const mockHnResponse = {
        hits: [
          { objectID: '101', title: '[dead] Freelance React developer needed', author: 'user1', created_at_i: 1729850000 },
          { objectID: '102', title: '[DEAD] Looking for agency', author: 'user2', created_at_i: 1729850000 },
          { objectID: '103', title: '[deleted]', author: 'user3', created_at_i: 1729850000 },
          { objectID: '104', title: '[Deleted] Need WordPress developer', author: 'user4', created_at_i: 1729850000 },
          { objectID: '105', title: '   ', author: 'user5', created_at_i: 1729850000 },
          { objectID: '106', title: 'Valid Lead: Hiring Next.js Designer', author: 'valid_user', created_at_i: 1729850000 },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockHnResponse,
      } as any);

      const connector = new HackerNewsConnector();
      const result = await connector.collect({ query: 'hiring' });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].source_record_id).toBe('106');
      expect(result.records[0].title).toBe('Valid Lead: Hiring Next.js Designer');
    });

    it('applies default 30-day cutoff filter when sinceTimestamp is omitted', async () => {
      let requestedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ hits: [] }),
        });
      });

      const connector = new HackerNewsConnector();
      await connector.collect({ query: 'agency lead' });

      expect(requestedUrl).toContain('numericFilters=created_at_i>=');
    });

    it('omits publication cutoff when allowHistorical is explicitly set to true', async () => {
      let requestedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ hits: [] }),
        });
      });

      const connector = new HackerNewsConnector();
      await connector.collect({ query: 'agency lead', allowHistorical: true });

      expect(requestedUrl).not.toContain('numericFilters');
    });

    it('honors explicit sinceTimestamp parameter when provided', async () => {
      let requestedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ hits: [] }),
        });
      });

      const connector = new HackerNewsConnector();
      await connector.collect({ query: 'agency lead', sinceTimestamp: 1690000000 });

      expect(requestedUrl).toContain('numericFilters=created_at_i>=1690000000');
    });

    it('handles empty search hits gracefully without errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ hits: [] }),
      } as any);

      const connector = new HackerNewsConnector();
      const result = await connector.collect({ query: 'obscure query string with no hits' });

      expect(result.diagnostic.status).toBe('EMPTY');
      expect(result.records).toHaveLength(0);
    });
  });

  describe('4. Hardened Public RSS & Atom Connector with SSRF Protections', () => {
    const rssConnector = new PublicRssConnector();

    it('ensures DEFAULT_FEED_REGISTRY contains zero Reddit feeds and only independent sources', () => {
      expect(DEFAULT_FEED_REGISTRY.length).toBeGreaterThan(0);
      for (const entry of DEFAULT_FEED_REGISTRY) {
        expect(entry.url).not.toContain('reddit.com');
        expect(entry.id).not.toContain('reddit');
        expect(entry.name).toBeDefined();
        expect(entry.scope).toBeDefined();
      }
    });

    it('parses valid RSS 2.0 XML with items, clean descriptions, and pubDate', () => {
      const sampleRss = `
        <?xml version="1.0" encoding="UTF-8" ?>
        <rss version="2.0">
          <channel>
            <title>Freelance Opportunities</title>
            <link>https://example.com</link>
            <item>
              <title>Need Next.js developer for marketing page</title>
              <link>https://example.com/jobs/101</link>
              <guid>job_101</guid>
              <description><![CDATA[<p>Looking for an experienced engineer to build 5 landing pages.</p>]]></description>
              <dc:creator>recruiter_bob</dc:creator>
              <pubDate>Sun, 25 Oct 2026 14:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
      `;

      const records = rssConnector.parseFeedXml(sampleRss, 'https://example.com/rss', 10);
      expect(records).toHaveLength(1);

      const r = records[0];
      expect(r.source_platform).toBe('rss');
      expect(r.source_record_id).toBe('job_101');
      expect(r.title).toBe('Need Next.js developer for marketing page');
      expect(r.content_text).toBe('Looking for an experienced engineer to build 5 landing pages.');
      expect(r.author_handle).toBe('recruiter_bob');
      expect(r.publication_timestamp).toBe('2026-10-25T14:00:00.000Z');
    });

    it('parses valid Atom 1.0 XML with entries, summaries, and updated dates', () => {
      const sampleAtom = `
        <?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Tech Startups Feed</title>
          <entry>
            <title>Evaluating CRMs for 50-person agency</title>
            <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
            <link rel="alternate" href="https://example.com/posts/evaluating-crms"/>
            <summary>We are comparing HubSpot and Salesforce and looking for recommendations.</summary>
            <author><name>agency_lead</name></author>
            <published>2026-10-26T08:30:00Z</published>
          </entry>
        </feed>
      `;

      const records = rssConnector.parseFeedXml(sampleAtom, 'https://example.com/atom', 10);
      expect(records).toHaveLength(1);

      const r = records[0];
      expect(r.source_platform).toBe('rss');
      expect(r.source_record_id).toBe('urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6');
      expect(r.source_url).toBe('https://example.com/posts/evaluating-crms');
      expect(r.author_handle).toBe('agency_lead');
      expect(r.publication_timestamp).toBe('2026-10-26T08:30:00.000Z');
    });

    it('blocks loopback and private IPv4/IPv6 addresses via isSafePublicUrl', async () => {
      const dangerousUrls = [
        'http://localhost:3000/feed.xml',
        'http://127.0.0.1:8080/rss',
        'http://10.0.0.5/rss',
        'http://192.168.1.100/feed',
        'http://172.16.0.1/atom',
        'http://[::1]/feed',
        'ftp://example.com/feed.xml',
      ];

      for (const url of dangerousUrls) {
        const check = await isSafePublicUrl(url);
        expect(check.safe).toBe(false);
      }
    });
  });

  describe('5. Ingestion Service Deduplication & Database Idempotency', () => {
    it('deduplicates identical posts across consecutive collection calls', async () => {
      const service = SocialIngestionService.getInstance();
      service.clearMemoryCache();

      const mockResult: SocialSignalRecord[] = [
        {
          source_platform: 'reddit',
          source_record_id: 'unique_1',
          source_url: 'https://reddit.com/r/1',
          author_handle: 'user1',
          publication_timestamp: new Date().toISOString(),
          retrieved_at: new Date().toISOString(),
          title: 'Post 1',
          content_text: 'Content 1',
          content_hash: createContentHash('reddit', 'unique_1', 'Content 1'),
          access_method: 'public_api',
          collection_status: 'SUCCESS',
        },
        {
          source_platform: 'reddit',
          source_record_id: 'unique_2',
          source_url: 'https://reddit.com/r/2',
          author_handle: 'user2',
          publication_timestamp: new Date().toISOString(),
          retrieved_at: new Date().toISOString(),
          title: 'Post 2',
          content_text: 'Content 2',
          content_hash: createContentHash('reddit', 'unique_2', 'Content 2'),
          access_method: 'public_api',
          collection_status: 'SUCCESS',
        },
      ];

      vi.spyOn(RedditConnector.prototype, 'collect').mockResolvedValue({
        records: mockResult,
        diagnostic: {
          platform: 'reddit',
          accessMethod: 'public_api',
          status: 'SUCCESS',
          recordsFound: 2,
          durationMs: 50,
        },
      });

      const report1 = await service.ingestSignals({ platforms: ['reddit'], saveToDatabase: false });
      expect(report1.totalCollected).toBe(2);
      expect(report1.records).toHaveLength(2);
      expect(report1.duplicatesSkipped).toBe(0);

      const report2 = await service.ingestSignals({ platforms: ['reddit'], saveToDatabase: false });
      expect(report2.totalCollected).toBe(2);
      expect(report2.records).toHaveLength(0);
      expect(report2.duplicatesSkipped).toBe(2);
    });

    it('persists records using composite sourcePlatform_sourceRecordId upsert', async () => {
      const service = SocialIngestionService.getInstance();
      service.clearMemoryCache();

      const upsertSpy = vi.spyOn((prisma as any).socialSignal, 'upsert').mockResolvedValue({} as any);

      const mockResult: SocialSignalRecord[] = [
        {
          source_platform: 'reddit',
          source_record_id: 'idempotent_100',
          source_url: 'https://reddit.com/r/test/100',
          author_handle: 'author_test',
          publication_timestamp: new Date().toISOString(),
          retrieved_at: new Date().toISOString(),
          title: 'Title 100',
          content_text: 'Content 100',
          content_hash: createContentHash('reddit', 'idempotent_100', 'Content 100'),
          access_method: 'public_api',
          collection_status: 'SUCCESS',
        },
      ];

      vi.spyOn(RedditConnector.prototype, 'collect').mockResolvedValue({
        records: mockResult,
        diagnostic: {
          platform: 'reddit',
          accessMethod: 'public_api',
          status: 'SUCCESS',
          recordsFound: 1,
          durationMs: 30,
        },
      });

      await service.ingestSignals({ platforms: ['reddit'], saveToDatabase: true });

      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const callArgs = upsertSpy.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        sourcePlatform_sourceRecordId: {
          sourcePlatform: 'reddit',
          sourceRecordId: 'idempotent_100',
        },
      });
      expect(callArgs.create.sourceRecordId).toBe('idempotent_100');
    });
  });

  describe('6. API Endpoint Protection & Input Validation', () => {
    const TEST_API_SECRET = 'leadpilot_test_secret_for_hardening_auth_123456';

    beforeEach(() => {
      process.env.INTERNAL_API_SECRET = TEST_API_SECRET;
    });

    it('rejects unauthenticated GET requests with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals', {
        method: 'GET',
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    it('rejects unauthenticated POST requests with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'need agency' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    it('authorizes GET requests with valid Bearer token', async () => {
      vi.spyOn(SocialIngestionService.prototype, 'getStoredSignals').mockResolvedValue([]);

      const req = new NextRequest('http://localhost:3000/api/social-signals', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TEST_API_SECRET}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('validates invalid platform query parameter with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals?platform=facebook_invalid', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TEST_API_SECRET}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid platform parameter');
    });

    it('validates invalid limit query parameter with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals?limit=99999', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TEST_API_SECRET}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid limit parameter');
    });

    it('validates invalid since query parameter with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals?since=not-a-valid-date', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TEST_API_SECRET}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid since parameter');
    });

    it('validates invalid POST query length with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_SECRET}`,
        },
        body: JSON.stringify({ query: 'x' }), // Too short (<2 chars)
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid query parameter');
    });
  });
});
