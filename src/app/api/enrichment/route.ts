import { NextRequest, NextResponse } from 'next/server';
import { enrichContact, EnrichmentInput } from '@/lib/enrichment';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Company is PRIMARY: ensure at least company_name or company_domain is present
    if (!body?.company_name && !body?.company_domain) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing primary company identifier: either company_name or company_domain must be provided',
        },
        { status: 400 }
      );
    }

    const input: EnrichmentInput = {
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      company_name: body.company_name ?? null,
      company_domain: body.company_domain ?? null,
      company_city: body.company_city ?? null,
      company_country: body.company_country ?? null,
      fields: Array.isArray(body.fields) && body.fields.length > 0 ? body.fields : ['workEmail', 'personalEmail', 'phone'],
    };

    const result = await enrichContact(input);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Enrichment API Error]:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Enrichment pipeline error',
      },
      { status: 500 }
    );
  }
}
