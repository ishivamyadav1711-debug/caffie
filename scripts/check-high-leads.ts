import { prisma } from '../src/lib/prisma';

async function main() {
  const highLeads = await (prisma as any).socialLead.findMany({
    where: { score: { gte: 80 } },
    select: {
      id: true,
      platform: true,
      author: true,
      company: true,
      score: true,
      enrichedEmail: true,
      enrichedProvider: true,
      title: true,
    },
    orderBy: { score: 'desc' },
  });

  console.log(`High Intent Leads (score >= 80): ${highLeads.length}\n`);
  for (const l of highLeads) {
    console.log(`- [${l.platform.toUpperCase()}] ${l.author}`);
    console.log(`  Title:    ${l.title}`);
    console.log(`  Email:    ${l.enrichedEmail || 'None'}`);
    console.log(`  Provider: ${l.enrichedProvider || 'None'}`);
    console.log(`  Company:  ${l.company || 'None'}`);
    console.log('----------------------------------------------------');
  }
}

main().finally(() => prisma.$disconnect());
