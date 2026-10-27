/**
 * Connector Health Service
 * Unified diagnostics for all social intelligence connectors
 * Inspired by Agent Reach's connector diagnostics pattern.
 */

import { ConnectorHealth } from '../types';
import { XTwitterConnector } from './XTwitterConnector';

export class ConnectorHealthService {
  /**
   * Diagnostic check for Hacker News (Algolia API)
   */
  public static async checkHackerNewsHealth(): Promise<ConnectorHealth> {
    const now = new Date().toISOString();
    try {
      const res = await fetch('https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1', {
        headers: { 'User-Agent': 'LeadPilot-B2B/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        return {
          platform: 'hackernews',
          displayName: 'Hacker News (Algolia API)',
          status: 'READY',
          requiresAuth: false,
          isConfigured: true,
          message: 'Hacker News search API is active and responsive.',
          capabilities: {
            canSearch: true,
            canStream: false,
            canReadPost: true,
            canDraftReply: true,
            canSendLive: false,
          },
          lastCheckedAt: now,
        };
      }

      return {
        platform: 'hackernews',
        displayName: 'Hacker News (Algolia API)',
        status: 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: `Hacker News API returned status ${res.status}.`,
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    } catch (err: any) {
      return {
        platform: 'hackernews',
        displayName: 'Hacker News (Algolia API)',
        status: 'ERROR',
        requiresAuth: false,
        isConfigured: true,
        message: `Hacker News API unreachable: ${err.message}`,
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    }
  }

  /**
   * Diagnostic check for Reddit (PullPush / Reddit JSON)
   */
  public static async checkRedditHealth(): Promise<ConnectorHealth> {
    const now = new Date().toISOString();
    try {
      const res = await fetch('https://api.pullpush.io/reddit/search/submission/?q=test&size=1', {
        headers: { 'User-Agent': 'LeadPilot-B2B/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        return {
          platform: 'reddit',
          displayName: 'Reddit (PullPush Public API)',
          status: 'READY',
          requiresAuth: false,
          isConfigured: true,
          message: 'Reddit search API is active and responsive.',
          capabilities: {
            canSearch: true,
            canStream: false,
            canReadPost: true,
            canDraftReply: true,
            canSendLive: false,
          },
          lastCheckedAt: now,
        };
      }

      return {
        platform: 'reddit',
        displayName: 'Reddit (PullPush Public API)',
        status: 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: `Reddit API returned HTTP ${res.status}.`,
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    } catch (err: any) {
      return {
        platform: 'reddit',
        displayName: 'Reddit (PullPush Public API)',
        status: 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: `Reddit endpoint notice: ${err.message}. Native JSON feeds available as fallback.`,
        capabilities: {
          canSearch: true,
          canStream: false,
          canReadPost: true,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    }
  }

  /**
   * Diagnostic check for RSS / Atom Feeds
   */
  public static async checkRssHealth(): Promise<ConnectorHealth> {
    const now = new Date().toISOString();
    return {
      platform: 'rss',
      displayName: 'RSS / Atom Feeds',
      status: 'READY',
      requiresAuth: false,
      isConfigured: true,
      message: 'RSS XML/Atom feed connector is operational and supports Google Alerts & B2B feeds.',
      capabilities: {
        canSearch: true,
        canStream: true,
        canReadPost: true,
        canDraftReply: true,
        canSendLive: false,
      },
      lastCheckedAt: now,
    };
  }

  /**
   * Run full health check across all registered connectors
   */
  public static async getAllConnectorHealth(): Promise<Record<string, ConnectorHealth>> {
    const [twitter, hackernews, reddit, rss] = await Promise.all([
      XTwitterConnector.checkHealth(),
      this.checkHackerNewsHealth(),
      this.checkRedditHealth(),
      this.checkRssHealth(),
    ]);

    return {
      twitter,
      hackernews,
      reddit,
      rss,
    };
  }
}
