import { NextRequest, NextResponse } from 'next/server';
import { enrichContact } from '@/lib/enrichment';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.first_name) {
      return NextResponse.json({ error: 'first_name is required' }, { status: 400 });
    }
    const result = await enrichContact({
      first_name: String(body.first_name).trim(),
      last_name: body.last_name ? String(body.last_name).trim() : undefined,
      company_domain: body.company_domain ? String(body.company_domain).trim() : undefined,
      company_name: body.company_name ? String(body.company_name).trim() : undefined,
      company_country: body.company_country ? String(body.company_country).trim() : undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Enrichment API Error]:', err);
    return NextResponse.json({ error: err.message || 'Enrichment failed' }, { status: 500 });
  }
}
