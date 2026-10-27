import { describe, it, expect, vi } from 'vitest';
import { XTwitterConnector } from '@/lib/social/connectors/XTwitterConnector';
import { RssFeedConnector } from '@/lib/social/connectors/rssConnector';
import { ConnectorHealthService } from '@/lib/social/connectors/ConnectorHealthService';
import { GroundedOutreachGenerator } from '@/lib/outreach/groundedOutreachGenerator';

describe('X / Twitter Connector & Diagnostics (Agent Reach Pattern)', () => {
  it('reports NOT_CONFIGURED status when no Bearer token is provided', async () => {
    // Ensure tokens are absent
    const origToken = process.env.TWITTER_BEARER_TOKEN;
    delete process.env.TWITTER_BEARER_TOKEN;
    delete process.env.X_API_KEY;

    try {
      const health = await XTwitterConnector.checkHealth();
      expect(health.platform).toBe('twitter');
      expect(health.status).toBe('NOT_CONFIGURED');
      expect(health.requiresAuth).toBe(true);
      expect(health.isConfigured).toBe(false);
      expect(health.capabilities.canSearch).toBe(false);
      expect(health.capabilities.canSendLive).toBe(false);
      expect(health.message).toContain('TWITTER_BEARER_TOKEN');
    } finally {
      if (origToken) process.env.TWITTER_BEARER_TOKEN = origToken;
    }
  });

  it('safely rejects search without throwing when unconfigured', async () => {
    delete process.env.TWITTER_BEARER_TOKEN;
    delete process.env.X_API_KEY;

    const result = await XTwitterConnector.searchTweets('looking for CRM');
    expect(result.signals).toHaveLength(0);
    expect(result.error).toContain('X API not configured');
  });

  it('enforces safety policy blocking unapproved automated live posting', async () => {
    const postResult = await XTwitterConnector.publishReply('12345', 'Hello prospect');
    expect(postResult.success).toBe(false);
    expect(postResult.error).toContain('safety policy');
  });
});

describe('RSS / Atom Feed Connector', () => {
  it('parses RSS 2.0 XML with HTML stripping and signal normalization', () => {
    const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SaaS Discussion</title>
    <item>
      <title>Looking for an alternative to Salesforce for 20 reps</title>
      <link>https://example.com/post/101</link>
      <description>&lt;p&gt;Salesforce is getting too expensive for us. We need a simpler &lt;strong&gt;CRM&lt;/strong&gt; with lead scoring.&lt;/p&gt;</description>
      <pubDate>Tue, 27 Oct 2026 12:00:00 GMT</pubDate>
      <author>founder@startup.com</author>
    </item>
  </channel>
</rss>`;

    const signals = RssFeedConnector.parseXml(sampleRssXml, 'SaaS Forum', 'https://example.com/rss', 10);
    expect(signals).toHaveLength(1);

    const sig = signals[0];
    expect(sig.platform).toBe('rss');
    expect(sig.url).toBe('https://example.com/post/101');
    expect(sig.title).toBe('Looking for an alternative to Salesforce for 20 reps');
    // HTML tags should be completely stripped
    expect(sig.text).not.toContain('<p>');
    expect(sig.text).not.toContain('<strong>');
    expect(sig.text).toContain('Salesforce is getting too expensive for us');
    expect(sig.text).toContain('CRM');
  });

  it('parses Atom XML format (<entry>) correctly', () => {
    const sampleAtomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>B2B Feed</title>
  <entry>
    <title>Need software recommendations for outbound emailing</title>
    <link href="https://example.com/atom/202" />
    <id>urn:uuid:12345</id>
    <content type="html">&lt;div&gt;Anyone know a good tool for deliverability tracking?&lt;/div&gt;</content>
    <author>
      <name>GrowthLead</name>
    </author>
    <updated>2026-10-27T10:00:00Z</updated>
  </entry>
</feed>`;

    const signals = RssFeedConnector.parseXml(sampleAtomXml, 'B2B Feed', 'https://example.com/atom', 10);
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('Need software recommendations for outbound emailing');
    expect(signals[0].author).toBe('GrowthLead');
    expect(signals[0].url).toBe('https://example.com/atom/202');
    expect(signals[0].text).toContain('Anyone know a good tool for deliverability tracking?');
  });
});

describe('Grounded Outreach Generator (SignalPipe Pattern)', () => {
  it('generates grounded, non-hallucinatory cold outreach draft', async () => {
    const draft = await GroundedOutreachGenerator.generateDraft({
      platform: 'reddit',
      originalPostUrl: 'https://reddit.com/r/SaaS/comments/test',
      postTitle: 'Looking for alternative to HubSpot for small sales team',
      postText: 'HubSpot pricing increased 40% this quarter. Looking for an affordable CRM with good email sequencing.',
      authorName: 'Alex Rivera',
      companyName: 'Acme SaaS',
      intentCategory: 'COMPLAINT_VENDOR',
    });

    expect(draft.subject).toBeTruthy();
    expect(draft.body).toBeTruthy();
    expect(draft.requiresApproval).toBe(true);
    // Body should mention their specific stated requirement or quote
    expect(draft.body.toLowerCase()).toMatch(/hubspot|crm|software|requirement|alternative/);
    expect(draft.evidenceQuote).toBeTruthy();
  });
});
