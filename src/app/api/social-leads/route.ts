import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform');
    const minScore = searchParams.get('minScore') ? parseInt(searchParams.get('minScore')!, 10) : undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const keyword = searchParams.get('q') || searchParams.get('keyword');

    const where: any = {};
    if (platform) {
      where.platform = platform.toLowerCase();
    }
    if (minScore !== undefined && !isNaN(minScore)) {
      where.score = { gte: minScore };
    }
    if (keyword && keyword.trim()) {
      const q = keyword.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { selftext: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
      ];
    }

    const leads = await (prisma as any).socialLead.findMany({
      where,
      orderBy: [
        { score: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    });

    const totalCount = await (prisma as any).socialLead.count({ where });

    return NextResponse.json({
      success: true,
      count: leads.length,
      totalCount,
      leads,
    });
  } catch (error: any) {
    console.error('Error fetching social leads:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch social leads' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, title, selftext, url, author, company, score, intentCategory, reason, enrichedEmail, enrichedPhone } = body;

    if (!platform || !title || !url) {
      return NextResponse.json(
        { success: false, error: 'platform, title, and url are required' },
        { status: 400 }
      );
    }

    const lead = await (prisma as any).socialLead.upsert({
      where: { url },
      update: {
        platform,
        title,
        selftext: selftext || null,
        author: author || null,
        company: company || null,
        score: score ? Math.round(Number(score)) : 0,
        intentCategory: intentCategory || null,
        reason: reason || null,
        ...(enrichedEmail ? { enrichedEmail } : {}),
        ...(enrichedPhone ? { enrichedPhone } : {}),
      },
      create: {
        platform,
        title,
        selftext: selftext || null,
        url,
        author: author || null,
        company: company || null,
        score: score ? Math.round(Number(score)) : 0,
        intentCategory: intentCategory || null,
        reason: reason || null,
        enrichedEmail: enrichedEmail || null,
        enrichedPhone: enrichedPhone || null,
      },
    });

    return NextResponse.json({ success: true, lead }, { status: 201 });
  } catch (error: any) {
    console.error('Error saving social lead:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save social lead' },
      { status: 500 }
    );
  }
}
