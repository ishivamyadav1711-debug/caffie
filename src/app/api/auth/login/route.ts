import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/lib/auth/sessionService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    const adminEmail = process.env.LEADPILOT_ADMIN_EMAIL;
    const adminPassword = process.env.LEADPILOT_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return NextResponse.json(
        { error: 'Internal login configuration is missing.' },
        { status: 500 }
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    // Secure comparison (simple exact match since it's an internal admin bypass)
    // A production system might use a constant-time comparison, but this is a single internal credential.
    if (email !== adminEmail || password !== adminPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // Upsert the admin user to ensure they exist in the DB for relationships
    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        name: 'LeadPilot Admin',
        role: 'ADMIN',
      },
    });

    // Create server-side session
    await createSession(user.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
