import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      where: {
        organizationId: session.organizationId,
      },
      include: {
        _count: {
          select: {
            socialConnections: true,
            contents: true,
          },
        },
      },
      orderBy: [
        { isFavorite: 'desc' },
        { name: 'asc' },
      ],
    });

    return NextResponse.json({ workspaces });
  } catch (error: any) {
    console.error('Fetch workspaces error:', error);
    return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  try {
    const { name, logoUrl } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Workspace name is required' }, { status: 400 });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const workspace = await prisma.workspace.create({
      data: {
        organizationId: session.organizationId,
        name,
        slug,
        logoUrl: logoUrl || 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=120&auto=format&fit=crop&q=80',
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId: workspace.id,
        userId: session.userId,
        action: 'CREATE_WORKSPACE',
        entityType: 'Workspace',
        entityId: workspace.id,
        details: JSON.stringify({ name: workspace.name, slug: workspace.slug }),
      },
    });

    return NextResponse.json({ workspace });
  } catch (error: any) {
    console.error('Create workspace error:', error);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
}
