import { BaseActor, ActorContext } from '@/models/Actor';
import { LLMProviderFactory } from '@/lib/ai/llmProvider';
import { WebSearchDiscoveryProvider } from '@/providers/WebSearchDiscoveryProvider';
import { PrismaClient } from '@prisma/client';
import { GmvEvidenceValidator } from '@/lib/commercial/GmvEvidenceValidator';
import { logger } from '@/utils/logger';

const prisma = new PrismaClient();

export interface CommercialEnrichmentInput {
  leadId: string;
  businessName: string;
  category: string;
  city?: string;
  state?: string;
  websiteUrl?: string;
}

export interface CommercialEnrichmentOutput {
  milestones: any[];
}

export class CommercialEnrichmentActor extends BaseActor<CommercialEnrichmentInput[], CommercialEnrichmentOutput[]> {
  readonly actorId = 'actor_commercial_enrichment';
  readonly name = 'Commercial Intelligence Actor';
  readonly priority = 'LOW' as const;
  readonly blocking = false;
  readonly timeoutMs = 45000;
  readonly dependencies = [];

  private searchProvider = new WebSearchDiscoveryProvider();
  private gmvValidator = new GmvEvidenceValidator();

  protected async run(context: ActorContext<CommercialEnrichmentInput[]>): Promise<{
    data: CommercialEnrichmentOutput[];
    sources: string[];
  }> {
    const leads = context.input;
    const llm = LLMProviderFactory.getProvider();
    
    if (!llm.isConfigured()) {
      context.onProgress?.('LLM not configured. Skipping Commercial Enrichment.');
      return { data: leads.map(() => ({ milestones: [] })), sources: [] };
    }

    const results: CommercialEnrichmentOutput[] = [];
    context.onProgress?.(`Starting commercial enrichment for ${leads.length} leads...`);

    for (const lead of leads) {
      const startTime = Date.now();
      const metrics: any = {
        businessId: lead.leadId,
        sourcesFound: 0,
        sourcesFetched: 0,
        gmvCandidates: 0,
        gmvVerified: 0,
        rejected: 0,
        rejectionReasons: [] as string[]
      };

      try {
        const queryTarget = lead.city ? `${lead.businessName} ${lead.city}` : lead.businessName;
        
        // Strict search queries for GMV
        const queries = [
          `"${queryTarget}" GMV`,
          `"${queryTarget}" "Gross Merchandise Value"`,
          `"${queryTarget}" "GMV milestone"`,
          `"${queryTarget}" "GMV crossed"`,
          `"${queryTarget}" "billion GMV"`
        ];

        let combinedSnippets = '';
        let sourceMap: Map<string, any> = new Map();
        
        for (const query of queries) {
          const searchResults = await this.searchProvider.executeSearchQuery(query);
          for (const res of searchResults.slice(0, 3)) {
             metrics.sourcesFound++;
             if (res.snippet && res.snippet.length > 10 && res.link) {
               combinedSnippets += `SourceURL: ${res.link}\nTitle: ${res.title}\nSnippet: ${res.snippet}\n\n`;
               sourceMap.set(res.link, res);
             }
          }
        }

        if (sourceMap.size === 0) {
          results.push({ milestones: [] });
          this.logTelemetry(metrics, startTime);
          continue;
        }

        metrics.gmvCandidates = sourceMap.size;

        const prompt = `
You are a strict GMV intelligence extractor.
Your task is to extract ONLY Gross Merchandise Value (GMV) milestones for the business: "${lead.businessName}".
DO NOT extract revenue, sales, funding, ARR, MRR, or founding dates.
If the provided snippets do not contain EXPLICIT evidence of GMV, return an empty array.

Here are the search snippets:
${combinedSnippets}

Extract milestones in the following JSON array format:
[
  {
    "milestoneType": "FIRST_GMV",
    "gmvAmount": 1000000, 
    "gmvCurrency": "USD",
    "dateString": "YYYY-MM-DD" or "YYYY-MM" or "YYYY",
    "dateAccuracy": "EXACT" | "MONTH_YEAR" | "YEAR",
    "evidenceUrl": "The exact URL from the snippets",
    "snippet": "The exact quote from the snippet proving this"
  }
]

ONLY return valid JSON. Do not include markdown formatting or other text.
`;

        const llmRes = await llm.generateText(prompt, 'You are an objective and strict data extractor.', {
          temperature: 0.0,
          jsonMode: true,
          maxTokens: 1000
        });

        let parsed = [];
        try {
          parsed = JSON.parse(llmRes.text);
        } catch (e) {
          const cleaned = llmRes.text.replace(/```json/g, '').replace(/```/g, '').trim();
          try {
             parsed = JSON.parse(cleaned);
          } catch (e2) {
             parsed = [];
          }
        }

        if (!Array.isArray(parsed)) parsed = [];

        const validMilestones = [];
        let earliestGmvDate: string | null = null;
        let earliestDateVal: number = Infinity;

        for (const m of parsed) {
          if (!m.dateString || !m.evidenceUrl || !m.snippet) continue;
          if (m.dateAccuracy === "ESTIMATED") continue;

          // Deterministic Validation
          const validation = await this.gmvValidator.validateEvidence({
            evidenceText: m.snippet,
            sourceUrl: m.evidenceUrl,
            businessName: lead.businessName,
            claimedGmvAmount: m.gmvAmount,
            claimedDate: m.dateString,
            claimedDateAccuracy: m.dateAccuracy
          });
          
          metrics.sourcesFetched++;

          if (!validation.valid) {
            metrics.rejected++;
            metrics.rejectionReasons.push(validation.rejectionReason || 'UNKNOWN');
            continue;
          }

          metrics.gmvVerified++;

          const sourceMeta = sourceMap.get(m.evidenceUrl);

          // Save Evidence & Milestone
          const milestone = await prisma.commercialMilestone.create({
            data: {
              businessId: lead.leadId,
              milestoneType: 'GMV_MILESTONE',
              gmvAmount: m.gmvAmount,
              gmvCurrency: m.gmvCurrency,
              eventDate: m.dateString,
              dateAccuracy: m.dateAccuracy,
              confidence: 1.0,
              verificationStatus: 'VERIFIED',
              evidence: {
                create: {
                  sourceUrl: m.evidenceUrl,
                  sourceTitle: sourceMeta?.title,
                  sourceTier: 'TIER_3', // Assuming search results as tier 3 for now unless classified
                  verificationStatus: 'VERIFIED',
                  evidenceText: m.snippet
                }
              }
            },
            include: { evidence: true }
          });
          
          validMilestones.push(milestone);

          // Track Earliest Date
          let dVal = new Date(m.dateString).getTime();
          if (!isNaN(dVal) && dVal < earliestDateVal) {
             earliestDateVal = dVal;
             earliestGmvDate = m.dateString;
          }
        }

        // Update First Known GMV Date on Business
        if (earliestGmvDate) {
          await prisma.business.update({
             where: { id: lead.leadId },
             data: { firstKnownGmvDate: earliestGmvDate }
          });
        }

        results.push({ milestones: validMilestones });
        this.logTelemetry(metrics, startTime);

      } catch (err) {
        metrics.rejected++;
        metrics.rejectionReasons.push('ACTOR_ERROR');
        results.push({ milestones: [] });
        this.logTelemetry(metrics, startTime);
      }
    }

    return {
      data: results,
      sources: ['Web Search', 'Gemini AI']
    };
  }

  private logTelemetry(metrics: any, startTime: number) {
    metrics.duration = Date.now() - startTime;
    logger.info({
      event: 'COMMERCIAL_RESEARCH_COMPLETED',
      ...metrics
    });
  }
}

export const commercialEnrichmentActor = new CommercialEnrichmentActor();
