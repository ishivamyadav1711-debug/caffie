import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Querying Prisma SocialLead table for the 5 most recent records ---');
  const leads = await (prisma as any).socialLead.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      platform: true,
      author: true,
      title: true,
      url: true,
      score: true,
      reason: true,
      intentCategory: true,
      createdAt: true,
    },
  });

  console.log(`Found ${leads.length} leads in database:\n`);
  leads.forEach((lead: any, index: number) => {
    console.log(`[Lead #${index + 1}]`);
    console.log(`  Platform:       ${lead.platform}`);
    console.log(`  Author:         ${lead.author}`);
    console.log(`  Title:          ${lead.title}`);
    console.log(`  Post URL:       ${lead.url}`);
    console.log(`  Intent Score:   ${lead.score}/100 (${lead.intentCategory})`);
    console.log(`  AI Reason:      ${lead.reason}`);
    console.log(`  Created At:     ${lead.createdAt}`);
    console.log('-------------------------------------------------------------');
  });
}

main()
  .catch((e) => {
    console.error('Error querying SocialLead table:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
