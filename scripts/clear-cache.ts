import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load both .env and .env.local
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function clearDatabase(dbUrl: string, name: string) {
  console.log(`Connecting to ${name}...`);
  const prisma = new PrismaClient({
    datasources: {
      db: { url: dbUrl }
    }
  });

  try {
    const existing = await prisma.enrichmentResult.findMany();
    console.log(`[${name}] Found ${existing.length} enrichment results:`);
    for (const r of existing) {
      console.log(`  - dedupKey: ${r.dedupKey} | phone: ${r.phone} | work: ${r.workEmail} | personal: ${r.personalEmail}`);
    }

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EnrichmentResult" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EnrichmentRequest" CASCADE;`);
    console.log(`[${name}] Successfully truncated EnrichmentResult and EnrichmentRequest with CASCADE.`);
  } catch (err) {
    console.error(`[${name}] Error clearing cache:`, err);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const envDbUrl = process.env.DATABASE_URL;
  if (envDbUrl) {
    await clearDatabase(envDbUrl, 'DATABASE_URL (Neon main/pooler)');
  }

  const directUrl = process.env.DIRECT_URL;
  if (directUrl && directUrl !== envDbUrl) {
    await clearDatabase(directUrl, 'DIRECT_URL (Neon direct)');
  }

  const recoveryUrl = process.env.RECOVERY_URL;
  if (recoveryUrl && recoveryUrl !== envDbUrl && recoveryUrl !== directUrl) {
    await clearDatabase(recoveryUrl, 'RECOVERY_URL (Neon patient-mountain)');
  }
}

main().catch(console.error);
