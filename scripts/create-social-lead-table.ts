import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('[DB Setup] Ensuring SocialLead table exists in PostgreSQL...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SocialLead" (
      "id" TEXT PRIMARY KEY,
      "platform" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "selftext" TEXT,
      "url" TEXT NOT NULL UNIQUE,
      "author" TEXT,
      "company" TEXT,
      "score" INTEGER NOT NULL,
      "intentCategory" TEXT,
      "reason" TEXT,
      "enrichedEmail" TEXT,
      "enrichedPhone" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "SocialLead" ADD COLUMN IF NOT EXISTS "company" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SocialLead" ADD COLUMN IF NOT EXISTS "enrichedEmail" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SocialLead" ADD COLUMN IF NOT EXISTS "enrichedProvider" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SocialLead" ADD COLUMN IF NOT EXISTS "enrichedPhone" TEXT`);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "SocialLead_url_key" ON "SocialLead"("url")
  `);

  console.log('[DB Setup] SocialLead table and index created/verified successfully in PostgreSQL.');
}

main()
  .catch((err) => {
    console.error('[DB Setup] Failed to create table:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
