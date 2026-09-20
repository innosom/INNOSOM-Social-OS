import { NextRequest, NextResponse } from 'next/server';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toLowerCase();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId query parameter is required' }, { status: 400 });
  }

  const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden workspace access' }, { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/oauth/${provider}/callback`;

  // Create state token encoding workspaceId, provider, and random nonce to prevent CSRF
  const nonce = crypto.randomBytes(16).toString('hex');
  const stateData = JSON.stringify({ workspaceId, provider, nonce, userId: session.userId });
  const state = Buffer.from(stateData).toString('base64url');

  let authUrl = '';

  switch (provider) {
    case 'facebook': {
      const appId = process.env.FACEBOOK_APP_ID || 'MOCK_FB_APP_ID';
      const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'publish_video'];
      authUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&state=${state}&scope=${scopes.join(',')}`;
      break;
    }

    case 'instagram': {
      const appId = process.env.INSTAGRAM_APP_ID || 'MOCK_IG_APP_ID';
      const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'];
      authUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&state=${state}&scope=${scopes.join(',')}`;
      break;
    }

    case 'tiktok': {
      const clientKey = process.env.TIKTOK_APP_ID || 'MOCK_TIKTOK_CLIENT_KEY';
      const scopes = ['user.info.basic', 'video.upload', 'video.publish'];
      authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${scopes.join(
        ','
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
      break;
    }

    case 'youtube': {
      const clientId = process.env.YOUTUBE_CLIENT_ID || 'MOCK_YT_CLIENT_ID';
      const scopes = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&response_type=code&scope=${encodeURIComponent(
        scopes.join(' ')
      )}&access_type=offline&prompt=consent&state=${state}`;
      break;
    }

    default:
      return NextResponse.json({ error: `Unsupported OAuth provider: ${provider}` }, { status: 400 });
  }

  // Set HTTP-only cookie with state nonce for verification in callback
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(`oauth_state_${provider}`, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  return response;
}
