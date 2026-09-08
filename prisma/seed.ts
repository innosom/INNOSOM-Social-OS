import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding for INNOSOM Social OS...');

  // 1. Clean existing data
  await prisma.auditLog.deleteMany({});
  await prisma.analyticsSnapshot.deleteMany({});
  await prisma.approval.deleteMany({});
  await prisma.publication.deleteMany({});
  await prisma.contentVariantMedia.deleteMany({});
  await prisma.contentVariant.deleteMany({});
  await prisma.content.deleteMany({});
  await prisma.mediaAsset.deleteMany({});
  await prisma.socialConnection.deleteMany({});
  await prisma.workspace.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  // 2. Create Organization
  const org = await prisma.organization.create({
    data: {
      name: 'INNOSOM Tech & Digital Solutions',
      slug: 'innosom',
      logoUrl: '/brands/innosom-logo.png',
    },
  });

  console.log(`✅ Organization created: ${org.name} (${org.id})`);

  // 3. Create Users
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@innosom.com',
      name: 'Ahmed Hassan',
      passwordHash: defaultPasswordHash,
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: 'manager@innosom.com',
      name: 'Fatima Jama',
      passwordHash: defaultPasswordHash,
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
    },
  });

  const editor = await prisma.user.create({
    data: {
      email: 'editor@innosom.com',
      name: 'Mohamed Salah',
      passwordHash: defaultPasswordHash,
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
  });

  // Assign Organization Memberships
  await prisma.membership.createMany({
    data: [
      { userId: admin.id, organizationId: org.id, role: 'ADMIN' },
      { userId: manager.id, organizationId: org.id, role: 'MANAGER' },
      { userId: editor.id, organizationId: org.id, role: 'EDITOR' },
    ],
  });

  console.log('✅ Users & Organization Memberships created.');

  // 4. Create Workspaces (Clients)
  const clientsData = [
    {
      name: 'Haji Abdi College',
      slug: 'haji-abdi-college',
      logoUrl: 'https://images.unsplash.com/photo-1562774053-701939374585?w=120&auto=format&fit=crop&q=80',
      isFavorite: true,
    },
    {
      name: 'Garowe General Hospital',
      slug: 'garowe-general-hospital',
      logoUrl: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=120&auto=format&fit=crop&q=80',
      isFavorite: true,
    },
    {
      name: 'East Africa University',
      slug: 'east-africa-university',
      logoUrl: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=120&auto=format&fit=crop&q=80',
      isFavorite: false,
    },
    {
      name: 'Nasiim Perfumes',
      slug: 'nasiim-perfumes',
      logoUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=120&auto=format&fit=crop&q=80',
      isFavorite: true,
    },
    {
      name: 'Alpha Industries',
      slug: 'alpha-industries',
      logoUrl: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=120&auto=format&fit=crop&q=80',
      isFavorite: false,
    },
  ];

  const createdWorkspaces = [];
  for (const c of clientsData) {
    const ws = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: c.name,
        slug: c.slug,
        logoUrl: c.logoUrl,
        isFavorite: c.isFavorite,
      },
    });
    createdWorkspaces.push(ws);
  }

  console.log(`✅ ${createdWorkspaces.length} Client Workspaces created.`);

  // 5. Connect Social Accounts for Workspaces
  const defaultCapabilities = JSON.stringify({
    canPublishImage: true,
    canPublishVideo: true,
    canPublishCarousel: true,
    canSchedule: true,
    supportsStories: true,
    supportsReels: true,
    supportsShorts: true,
    supportsAnalytics: true,
    maxCaptionLength: 2200,
  });

  const hajiAbdi = createdWorkspaces[0];
  const ggh = createdWorkspaces[1];
  const nasiim = createdWorkspaces[3];

  // Haji Abdi Connections
  const hajiFb = await prisma.socialConnection.create({
    data: {
      workspaceId: hajiAbdi.id,
      platform: 'FACEBOOK',
      accountName: 'Haji Abdi College Official Page',
      accountId: 'fb_haji_abdi_101',
      avatarUrl: hajiAbdi.logoUrl,
      status: 'CONNECTED',
      scopes: JSON.stringify(['pages_manage_posts', 'pages_read_engagement']),
      accessTokenEnc: 'enc_token_mock_fb_haji_abdi',
      capabilities: defaultCapabilities,
    },
  });

  const hajiIg = await prisma.socialConnection.create({
    data: {
      workspaceId: hajiAbdi.id,
      platform: 'INSTAGRAM',
      accountName: '@hajiabdi_college',
      accountId: 'ig_haji_abdi_102',
      avatarUrl: hajiAbdi.logoUrl,
      status: 'CONNECTED',
      scopes: JSON.stringify(['instagram_basic', 'instagram_content_publish']),
      accessTokenEnc: 'enc_token_mock_ig_haji_abdi',
      capabilities: defaultCapabilities,
    },
  });

  const hajiTt = await prisma.socialConnection.create({
    data: {
      workspaceId: hajiAbdi.id,
      platform: 'TIKTOK',
      accountName: '@hajiabdicollege_official',
      accountId: 'tt_haji_abdi_103',
      avatarUrl: hajiAbdi.logoUrl,
      status: 'EXPIRED',
      healthErrorMessage: 'OAuth access token expired. Please re-authenticate account connection.',
      scopes: JSON.stringify(['video.upload', 'user.info.basic']),
      accessTokenEnc: 'enc_token_mock_tt_expired',
      capabilities: defaultCapabilities,
    },
  });

  console.log('✅ Connected Social Accounts created.');

  // 6. Media Assets
  const media1 = await prisma.mediaAsset.create({
    data: {
      workspaceId: hajiAbdi.id,
      fileName: 'midterm_schedule_2026.png',
      fileSize: 1048576,
      mimeType: 'image/png',
      storageKey: 'haji-abdi/midterm_schedule_2026.png',
      publicUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&auto=format&fit=crop&q=80',
      width: 1200,
      height: 630,
      folderPath: '/Academic Calendar',
    },
  });

  // 7. Content & Publications for Haji Abdi
  const content1 = await prisma.content.create({
    data: {
      workspaceId: hajiAbdi.id,
      authorId: editor.id,
      title: 'Midterm Examinations Announcement 2026',
      masterCaption: 'Midterm examinations are officially underway at Haji Abdi College! Wishing all our students the absolute best of luck in their assessments.',
      status: 'APPROVED',
    },
  });

  const variantFb = await prisma.contentVariant.create({
    data: {
      contentId: content1.id,
      platform: 'FACEBOOK',
      caption: 'Midterm examinations are officially underway at Haji Abdi College! Wishing all our students the absolute best of luck in their assessments. Please check the student portal for room schedules.',
      hashtags: JSON.stringify(['#HajiAbdiCollege', '#Exams2026', '#ExcellenceInEducation']),
    },
  });

  const variantIg = await prisma.contentVariant.create({
    data: {
      contentId: content1.id,
      platform: 'INSTAGRAM',
      caption: 'Midterm examinations are officially underway at Haji Abdi College! 📚✨\n\nWishing all our students the absolute best of luck in their assessments.',
      hashtags: JSON.stringify(['#HajiAbdiCollege', '#Exams2026', '#FutureLeaders', '#Garowe']),
    },
  });

  await prisma.contentVariantMedia.createMany({
    data: [
      { contentVariantId: variantFb.id, mediaAssetId: media1.id, order: 0 },
      { contentVariantId: variantIg.id, mediaAssetId: media1.id, order: 0 },
    ],
  });

  // Publications
  const now = new Date();
  const scheduledTime = new Date(now.getTime() + 2 * 3600 * 1000);

  await prisma.publication.create({
    data: {
      contentVariantId: variantFb.id,
      socialConnectionId: hajiFb.id,
      scheduledAt: scheduledTime,
      status: 'SCHEDULED',
      idempotencyKey: `haji_abdi_fb_pub_${Date.now()}_1`,
    },
  });

  await prisma.publication.create({
    data: {
      contentVariantId: variantIg.id,
      socialConnectionId: hajiIg.id,
      scheduledAt: scheduledTime,
      status: 'APPROVED',
      idempotencyKey: `haji_abdi_ig_pub_${Date.now()}_2`,
    },
  });

  // 8. Analytics Snapshots
  const days = [0, 1, 2, 3, 4, 5, 6];
  for (const d of days) {
    const date = new Date();
    date.setDate(date.getDate() - d);

    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: hajiAbdi.id,
        platform: 'FACEBOOK',
        date,
        impressions: 1200 + d * 150,
        reach: 950 + d * 100,
        likes: 180 + d * 12,
        comments: 25 + d * 2,
        shares: 14 + d,
        clicks: 85 + d * 5,
        followers: 4500 + d * 10,
      },
    });
  }

  // 9. Initial Audit Log
  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      workspaceId: hajiAbdi.id,
      userId: admin.id,
      action: 'WORKSPACE_INITIALIZED',
      entityType: 'Workspace',
      entityId: hajiAbdi.id,
      details: JSON.stringify({ message: 'Initialized Haji Abdi College workspace and connected social channels.' }),
    },
  });

  console.log('🎉 Seeding complete successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
