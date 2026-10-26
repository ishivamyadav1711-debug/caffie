import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { enrichContact } from '../src/lib/enrichment';

async function test() {
  console.log('Testing enrichment waterfall...');
  const res = await enrichContact({ first_name: 'Alexis', last_name: 'Ohanian', company_domain: 'reddit.com' });
  console.log('Enrichment output:', JSON.stringify(res, null, 2));
}

test();
