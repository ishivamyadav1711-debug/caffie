/**
 * Grounded Outreach Generator
 * Inspired by SignalPipe's grounded draft guidelines:
 * - Strictly reference the prospect's stated problem without hallucinations.
 * - Concise, professional (max 3-4 sentences).
 * - Avoid fabricated claims, fake testimonials, or false familiarity.
 * - Explicitly mandate human approval.
 */

import { LLMProviderFactory } from '../ai/llmProvider';

export interface GroundedDraftInput {
  platform: string;
  originalPostUrl: string;
  postTitle: string;
  postText: string;
  authorName?: string;
  companyName?: string;
  intentCategory?: string;
  problemSummary?: string;
  productContext?: string;
}

export interface GroundedDraftResult {
  subject: string;
  body: string;
  evidenceQuote: string;
  intentAnchorsUsed: string[];
  requiresApproval: boolean;
  generatedBy: 'llm' | 'deterministic';
}

export class GroundedOutreachGenerator {
  /**
   * Deterministic grounded draft fallback
   */
  private static generateDeterministicDraft(input: GroundedDraftInput): GroundedDraftResult {
    const greeting = input.authorName && !input.authorName.startsWith('@')
      ? `Hi ${input.authorName.split(' ')[0]},`
      : 'Hello,';

    const platformLabel = input.platform === 'twitter'
      ? 'on X'
      : input.platform === 'reddit'
      ? 'on Reddit'
      : input.platform === 'hackernews'
      ? 'on Hacker News'
      : 'online';

    // Find a snippet of evidence
    const snippet = input.postText.length > 120
      ? input.postText.slice(0, 117) + '...'
      : (input.postText || input.postTitle);

    const subject = input.companyName
      ? `Quick note regarding ${input.companyName}'s software evaluation`
      : `Saw your note ${platformLabel} regarding software requirements`;

    const body = `${greeting}

I noticed your discussion ${platformLabel} regarding: "${snippet}".

We help B2B teams address this exact workflow by automating qualified lead intelligence and pipeline management without the usual manual overhead.

Would you be open to a brief look at how we solve this, or should I reach back out at a later time?

Best regards,
LeadPilot Team`;

    return {
      subject,
      body,
      evidenceQuote: snippet,
      intentAnchorsUsed: ['software evaluation', 'workflow requirement'],
      requiresApproval: true,
      generatedBy: 'deterministic',
    };
  }

  /**
   * Generates a context-specific, professional outreach draft
   */
  public static async generateDraft(input: GroundedDraftInput): Promise<GroundedDraftResult> {
    const llm = LLMProviderFactory.getProvider();

    if (!llm.isConfigured()) {
      return this.generateDeterministicDraft(input);
    }

    const systemInstruction = `You are a professional B2B outreach specialist.
Strict Rules:
1. Ground the draft strictly in the prospect's public post text. Never invent testimonials, existing relationships, case studies, or statistics.
2. Keep the body short: 3 to 4 sentences maximum.
3. Be respectful, professional, and clear.
4. Output valid JSON adhering strictly to:
{
  "subject": "Clear, relevant, non-spammy subject line",
  "body": "Complete email body including greeting and polite sign-off",
  "evidenceQuote": "Direct quote or close paraphrase from the post that proves relevance",
  "intentAnchorsUsed": ["array", "of", "relevant", "anchors"]
}`;

    const prompt = `Generate a personalized, grounded cold outreach email draft for this prospect:
Platform: ${input.platform}
Author/Handle: ${input.authorName || 'Prospect'}
Target Company: ${input.companyName || 'Not specified'}
Intent Category: ${input.intentCategory || 'Commercial Inquiry'}
Post Title: ${input.postTitle}
Post Content: ${input.postText.slice(0, 700)}
Sender Value Proposition: ${input.productContext || 'LeadPilot - B2B lead intelligence and buying-intent automation platform'}

Generate the email draft JSON:`;

    try {
      const res = await Promise.race([
        llm.generateText(prompt, systemInstruction, { jsonMode: true, maxTokens: 400 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Outreach LLM generation timed out')), 6000)),
      ]);

      let raw = res.text.trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) raw = match[0];
      const parsed = JSON.parse(raw);

      return {
        subject: String(parsed.subject || `Regarding your post on ${input.platform}`).trim(),
        body: String(parsed.body || '').trim(),
        evidenceQuote: String(parsed.evidenceQuote || input.postTitle).trim(),
        intentAnchorsUsed: Array.isArray(parsed.intentAnchorsUsed) ? parsed.intentAnchorsUsed : ['buying intent'],
        requiresApproval: true,
        generatedBy: 'llm',
      };
    } catch (err: any) {
      console.warn(`[Grounded Outreach Warning]: ${err.message}. Using deterministic template.`);
      return this.generateDeterministicDraft(input);
    }
  }
}
