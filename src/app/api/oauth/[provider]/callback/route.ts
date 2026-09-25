import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { encryptToken } from '@/lib/encryption';
import { SocialProviderFactory } from '@/modules/social/SocialProviderFactory';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toLowerCase();
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const oauthError = searchParams.get('error_description') || searchParams.get('error');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/oauth/${provider}/callback`;

  if (oauthError) {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent('Missing authorization code or state parameter.')}`);
  }

  // Validate state parameter and CSRF nonce cookie
  let parsedState: { workspaceId: string; provider: string; nonce: string; userId: string };
  try {
    const stateJson = Buffer.from(stateParam, 'base64url').toString('utf-8');
    parsedState = JSON.parse(stateJson);
  } catch {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent('Invalid OAuth state parameter.')}`);
  }

  const cookieNonce = req.cookies.get(`oauth_state_${provider}`)?.value;
  if (!cookieNonce || cookieNonce !== parsedState.nonce) {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent('OAuth CSRF state verification failed.')}`);
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent('Authentication required to complete OAuth flow.')}`);
  }

  const { hasAccess } = await validateWorkspaceAccess(session, parsedState.workspaceId, prisma);
  if (!hasAccess) {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent('Forbidden: You do not have access to this workspace.')}`);
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent('Forbidden: Insufficient permissions to connect social channels.')}`);
  }

  try {
    let accessToken = '';
    let refreshToken: string | null = null;
    let expiresAt: Date | null = null;
    let accountId = '';
    let accountName = '';
    let avatarUrl: string | null = null;

    const isLiveApis = process.env.ENABLE_LIVE_SOCIAL_APIS === 'true';

    if (isLiveApis) {
      if (provider === 'facebook' || provider === 'instagram') {
        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        // Exchange code for short-lived user access token
        const tokenUrl = `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&client_secret=${appSecret}&code=${code}`;

        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error.message || 'Meta OAuth token exchange failed');

        // Upgrade to long-lived user token
        const longLivedUrl = `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`;
        const longLivedRes = await fetch(longLivedUrl);
        const longLivedData = await longLivedRes.json();
        const finalToken = longLivedData.access_token || tokenData.access_token;
        const expiresInSec = longLivedData.expires_in || tokenData.expires_in || 5184000; // ~60 days

        accessToken = finalToken;
        expiresAt = new Date(Date.now() + expiresInSec * 1000);

        if (provider === 'facebook') {
          // Fetch pages owned by user
          const meRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${finalToken}`);
          const meData = await meRes.json();
          const firstPage = meData.data?.[0];

          if (firstPage) {
            accountId = firstPage.id;
            accountName = firstPage.name;
            accessToken = firstPage.access_token; // Page access token
          } else {
            const userRes = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${finalToken}`);
            const userData = await userRes.json();
            accountId = userData.id || `fb_${Date.now()}`;
            accountName = userData.name || 'Facebook Account';
            avatarUrl = userData.picture?.data?.url || null;
          }
        } else {
          // Instagram: Fetch connected IG Business Account
          const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${finalToken}`);
          const pagesData = await pagesRes.json();
          const igPage = pagesData.data?.find((p: any) => p.instagram_business_account);

          if (igPage?.instagram_business_account) {
            accountId = igPage.instagram_business_account.id;
            accountName = igPage.instagram_business_account.username;
            avatarUrl = igPage.instagram_business_account.profile_picture_url || null;
          } else {
            accountId = `ig_${Date.now()}`;
            accountName = 'Instagram Account';
          }
        }
      } else if (provider === 'tiktok') {
        const clientKey = process.env.TIKTOK_APP_ID;
        const clientSecret = process.env.TIKTOK_APP_SECRET;

        const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: clientKey!,
            client_secret: clientSecret!,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error.message || 'TikTok token exchange failed');

        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || null;
        expiresAt = new Date(Date.now() + (tokenData.expires_in || 86400) * 1000);
        accountId = tokenData.open_id || `tiktok_${Date.now()}`;
        accountName = 'TikTok Creator';
      } else if (provider === 'youtube') {
        const clientId = process.env.YOUTUBE_CLIENT_ID;
        const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId!,
            client_secret: clientSecret!,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description || 'YouTube token exchange failed');

        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || null;
        expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

        // Fetch YouTube channel details
        const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const channelData = await channelRes.json();
        const channel = channelData.items?.[0];

        if (channel) {
          accountId = channel.id;
          accountName = channel.snippet?.title || 'YouTube Channel';
          avatarUrl = channel.snippet?.thumbnails?.default?.url || null;
        } else {
          accountId = `yt_${Date.now()}`;
          accountName = 'YouTube Channel';
        }
      }
    } else {
      // Mock OAuth code exchange in non-production development mode
      accessToken = `mock_oauth_access_${provider}_${Date.now()}`;
      refreshToken = `mock_oauth_refresh_${provider}_${Date.now()}`;
      expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      accountId = `${provider}_acc_${Date.now()}`;
      accountName = `Mock ${provider.charAt(0).toUpperCase() + provider.slice(1)} Channel`;
    }

    // Encrypt sensitive access and refresh tokens
    const accessTokenEnc = encryptToken(accessToken)!;
    const refreshTokenEnc = refreshToken ? encryptToken(refreshToken) : null;

    const providerObj = SocialProviderFactory.getProvider(provider.toUpperCase());
    const capabilities = providerObj.getCapabilities();

    // Persist or update SocialConnection in DB
    const connection = await prisma.socialConnection.upsert({
      where: {
        workspaceId_platform_accountId: {
          workspaceId: parsedState.workspaceId,
          platform: provider.toUpperCase(),
          accountId,
        },
      },
      update: {
        accountName,
        avatarUrl,
        accessTokenEnc,
        refreshTokenEnc,
        expiresAt,
        status: 'CONNECTED',
        healthErrorMessage: null,
        capabilities: JSON.stringify(capabilities),
        lastCheckedAt: new Date(),
      },
      create: {
        workspaceId: parsedState.workspaceId,
        platform: provider.toUpperCase(),
        accountName,
        accountId,
        avatarUrl,
        accessTokenEnc,
        refreshTokenEnc,
        expiresAt,
        status: 'CONNECTED',
        scopes: JSON.stringify(['publish_content', 'read_insights']),
        capabilities: JSON.stringify(capabilities),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: (await prisma.workspace.findUnique({ where: { id: parsedState.workspaceId } }))?.organizationId || '',
        workspaceId: parsedState.workspaceId,
        userId: parsedState.userId,
        action: 'CONNECT_SOCIAL_ACCOUNT',
        entityType: 'SocialConnection',
        entityId: connection.id,
        details: JSON.stringify({ platform: provider.toUpperCase(), accountName, accountId }),
      },
    });

    const response = NextResponse.redirect(`${baseUrl}/settings?connected=${encodeURIComponent(provider.toUpperCase())}`);
    response.cookies.delete(`oauth_state_${provider}`);
    return response;
  } catch (error: any) {
    console.error(`OAuth callback error for ${provider}:`, error.message || error);
    return NextResponse.redirect(`${baseUrl}/settings?error=${encodeURIComponent(error.message || 'OAuth authorization failed.')}`);
  }
}
