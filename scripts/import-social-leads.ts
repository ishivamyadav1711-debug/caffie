import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

interface HighIntentLeadsFile {
  analyzedAt: string;
  totalAnalyzed: number;
  highIntentCount: number;
  threshold: number;
  leads: Array<{
    platform: string;
    title: string;
    selftext?: string;
    url: string;
    author?: string;
    score: number;
    intent_category?: string;
    intentCategory?: string;
    reason?: string;
  }>;
}

async function main() {
  console.log('='.repeat(65));
  console.log('  IMPORTING HIGH-INTENT SOCIAL LEADS INTO DATABASE');
  console.log('='.repeat(65));

  const jsonPath = path.resolve(process.cwd(), 'data', 'high-intent-leads.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`[Import] File not found: ${jsonPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data: HighIntentLeadsFile = JSON.parse(raw);
  const leads = data.leads || [];

  console.log(`[Import] Found ${leads.length} high-intent leads to ingest.`);

  let insertedCount = 0;
  let updatedCount = 0;

  for (const lead of leads) {
    const intentCategory = lead.intentCategory || lead.intent_category || 'general';

    const record = await (prisma as any).socialLead.upsert({
      where: { url: lead.url },
      update: {
        platform: lead.platform,
        title: lead.title,
        selftext: lead.selftext || null,
        author: lead.author || null,
        score: Math.round(lead.score),
        intentCategory,
        reason: lead.reason || null,
      },
      create: {
        platform: lead.platform,
        title: lead.title,
        selftext: lead.selftext || null,
        url: lead.url,
        author: lead.author || null,
        score: Math.round(lead.score),
        intentCategory,
        reason: lead.reason || null,
      },
    });

    console.log(`  -> Saved [${record.platform}] "${record.title.slice(0, 45)}..." (Score: ${record.score})`);
    insertedCount++;
  }

  const totalInDb = await (prisma as any).socialLead.count();

  console.log('\n' + '='.repeat(65));
  console.log(`Successfully imported ${insertedCount} leads into PostgreSQL.`);
  console.log(`Total SocialLead records currently in database: ${totalInDb}`);
  console.log('='.repeat(65));
}

main()
  .catch((err) => {
    console.error('Fatal error importing social leads:', err);
    process.exit(1);
  })
  .finally(async () => {
    await (prisma as any).$disconnect?.();
  });
