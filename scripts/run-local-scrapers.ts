import fs from 'fs';
import path from 'path';
import { scrapeReddit, RedditLead } from '../src/scrapers/redditScraper';
import { scrapeTwitter, TwitterLead } from '../src/scrapers/twitterScraper';

interface CombinedResults {
  timestamp: string;
  totalLeads: number;
  redditCount: number;
  twitterCount: number;
  leads: (RedditLead | TwitterLead)[];
}

async function main() {
  console.log('='.repeat(60));
  console.log('  STARTING LOCAL SOCIAL SCRAPERS (Reddit & X)');
  console.log('='.repeat(60));

  // --- Step 1: Reddit Scraper (Native Fetch JSON API) ---
  console.log('\n[Phase 1] Executing Reddit JSON API Scraper...');
  const redditQuery = 'need crm';
  const redditLimit = 10;
  let redditLeads: RedditLead[] = [];

  try {
    redditLeads = await scrapeReddit(redditQuery, redditLimit);
    console.log(`[Phase 1 Result] Reddit returned ${redditLeads.length} leads.`);
    if (redditLeads.length > 0) {
      console.log('Sample Reddit Lead:');
      console.log(` - Title: ${redditLeads[0].title}`);
      console.log(` - URL: ${redditLeads[0].url}`);
      console.log(` - Created UTC: ${redditLeads[0].created_utc}`);
    }
  } catch (err: any) {
    console.error(`[Phase 1 Error] Reddit scraping failed: ${err.message || err}`);
  }

  // --- Step 2: X/Twitter Scraper (Playwright Visible Mode) ---
  console.log('\n[Phase 2] Executing X/Twitter Playwright Scraper (Visible Mode)...');
  const twitterQuery = 'looking for crm';
  const twitterLimit = 10;
  let twitterLeads: TwitterLead[] = [];

  try {
    twitterLeads = await scrapeTwitter(twitterQuery, twitterLimit);
    console.log(`[Phase 2 Result] X/Twitter returned ${twitterLeads.length} leads.`);
    if (twitterLeads.length > 0) {
      console.log('Sample X/Twitter Lead:');
      console.log(` - Author: ${twitterLeads[0].author}`);
      console.log(` - Text: ${twitterLeads[0].text.substring(0, 100)}...`);
      console.log(` - URL: ${twitterLeads[0].url}`);
    }
  } catch (err: any) {
    console.error(`[Phase 2 Error] X/Twitter scraping failed: ${err.message || err}`);
  }

  // --- Step 3: Combine and Save to data/local-scraped-leads.json ---
  console.log('\n[Phase 3] Consolidating and Saving Results...');
  const outputData: CombinedResults = {
    timestamp: new Date().toISOString(),
    totalLeads: redditLeads.length + twitterLeads.length,
    redditCount: redditLeads.length,
    twitterCount: twitterLeads.length,
    leads: [...redditLeads, ...twitterLeads],
  };

  const outputDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'local-scraped-leads.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

  console.log(`\n============================================================`);
  console.log(`  SCRAPING SUMMARY`);
  console.log(`============================================================`);
  console.log(`- Reddit Leads Extracted  : ${redditLeads.length}`);
  console.log(`- X/Twitter Leads Extracted: ${twitterLeads.length}`);
  console.log(`- Total Leads Combined    : ${outputData.totalLeads}`);
  console.log(`- Output File Saved To    : ${outputPath}`);
  console.log(`============================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error running local scrapers:', err);
  process.exit(1);
});
