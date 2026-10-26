import { GET } from '../src/app/api/social-leads/route';
import { NextRequest } from 'next/server';

async function testApi() {
  console.log('Testing GET /api/social-leads...');
  const req = new NextRequest('http://localhost:3000/api/social-leads?minScore=70');
  const res = await GET(req);
  const json = await res.json();

  console.log('API Status:', res.status);
  console.log('API Result:', JSON.stringify(json, null, 2));

  if (res.status === 200 && json.success && json.count > 0) {
    console.log('SUCCESS: /api/social-leads returned valid leads from the database!');
  } else {
    console.error('FAILURE: Unexpected response from /api/social-leads');
    process.exit(1);
  }
}

testApi().catch((err) => {
  console.error('API Test Error:', err);
  process.exit(1);
});
