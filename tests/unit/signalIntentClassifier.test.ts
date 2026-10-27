import { describe, it, expect, vi } from 'vitest';
import { classifySignalIntent, IntentEvaluationInput } from '@/lib/ai/signalIntentClassifier';

describe('SignalPipe Buying-Intent Intelligence Engine', () => {
  it('should immediately disqualify seller self-promotion and product launches', async () => {
    const input: IntentEvaluationInput = {
      title: 'Show HN: We launched our new AI CRM tool today!',
      content: 'Hey everyone, check out my new side project for managing sales leads. Use promo code LAUNCH for 50% off.',
      author: 'founder_guy',
      platform: 'hackernews',
    };

    const result = await classifySignalIntent(input);
    expect(result.isBuyer).toBe(false);
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.intentCategory).toBe('SELLER_PROMOTION');
    expect(result.recommendedAction).toBe('DISMISS');
    expect(result.scoringMethod).toBe('DETERMINISTIC_RULES');
  });

  it('should immediately disqualify job seekers and resumes', async () => {
    const input: IntentEvaluationInput = {
      title: 'Looking for a job in frontend engineering (Hire me)',
      content: 'Here is my resume and portfolio review. Open to work full-time.',
      author: 'dev_seeking_job',
      platform: 'reddit',
    };

    const result = await classifySignalIntent(input);
    expect(result.isBuyer).toBe(false);
    expect(result.score).toBeLessThanOrEqual(20);
    expect(result.intentCategory).toBe('JOB_SEEKER');
    expect(result.recommendedAction).toBe('DISMISS');
    expect(result.scoringMethod).toBe('DETERMINISTIC_RULES');
  });

  it('should qualify explicit buyer requests seeking software tools', async () => {
    const input: IntentEvaluationInput = {
      title: 'Looking for recommendations for a B2B sales automation platform',
      content: 'We are expanding our SDR team and need a good software platform for managing outreach and contact enrichment. Willing to pay enterprise pricing.',
      author: 'growth_vp',
      platform: 'reddit',
    };

    const result = await classifySignalIntent(input);
    expect(result.isBuyer).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(['EXPLICIT_BUY_SIGNAL', 'RECOMMENDATION_REQUEST']).toContain(result.intentCategory);
    expect(result.recommendedAction).toBe('OUTREACH');
  });

  it('should enforce hard-floor (score >= 80) for competitor switching posts', async () => {
    const input: IntentEvaluationInput = {
      title: 'Switching from Salesforce because of pricing and complexity',
      content: 'We are cancelling our Salesforce contract next month. What is the best alternative for managing 50k leads without high per-seat costs?',
      author: 'ops_lead',
      platform: 'reddit',
    };

    const result = await classifySignalIntent(input);
    expect(result.isBuyer).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.intentCategory).toBe('COMPETITOR_SWITCH');
    expect(result.urgency).toBe('HIGH');
  });

  it('should classify general discussion without commercial signals as non-buyer', async () => {
    const input: IntentEvaluationInput = {
      title: 'What is your opinion on the history of database normalization?',
      content: 'Discussing the 1970 paper by Codd. I find third normal form interesting from an academic perspective.',
      author: 'cs_student',
      platform: 'hackernews',
    };

    const result = await classifySignalIntent(input);
    expect(result.isBuyer).toBe(false);
    expect(result.score).toBeLessThan(65);
    expect(result.intentCategory).toBe('GENERAL_DISCUSSION');
  });
});
