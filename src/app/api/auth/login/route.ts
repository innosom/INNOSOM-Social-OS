import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { setSessionCookie, getSession, clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const membership = user.memberships[0];
    if (!membership) {
      return NextResponse.json({ error: 'User belongs to no organization' }, { status: 403 });
    }

    const sessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    };

    await setSessionCookie(sessionPayload);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        organization: membership.organization,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
