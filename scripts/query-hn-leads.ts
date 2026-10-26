import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Querying Hacker News rows from SocialLead table ---');
  const hnLeads = await (prisma as any).socialLead.findMany({
    where: { platform: 'hackernews' },
    take: 3,
    orderBy: { createdAt: 'desc' },
    select: {
      platform: true,
      author: true,
      title: true,
      url: true,
      score: true,
      reason: true,
    },
  });

  hnLeads.forEach((lead: any, index: number) => {
    console.log(`[HN Lead #${index + 1}]`);
    console.log(`  Platform:     ${lead.platform}`);
    console.log(`  Author:       ${lead.author}`);
    console.log(`  Title:        ${lead.title}`);
    console.log(`  URL:          ${lead.url}`);
    console.log(`  Score/Reason: ${lead.score}/100 - ${lead.reason}`);
    console.log('-------------------------------------------------------------');
  });
}

main().finally(async () => await prisma.$disconnect());
