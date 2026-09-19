# Platform Audit & Social Provider Hardening Document

This document summarizes the audit, security hardening, capabilities, OAuth flows, and error classification for all supported social media platforms in **INNOSOM Social OS**: **Facebook**, **Instagram**, **TikTok**, and **YouTube**, as well as the **Mock Social Provider**.

---

## 1. Provider Abstraction & Strict Production Mode

### Provider Abstraction
All social media providers implement the `SocialProvider` interface (`src/modules/social/SocialProvider.ts`).

### Strict Production Configuration Check (`SocialProviderFactory.ts`)
- When `ENABLE_LIVE_SOCIAL_APIS="true"` or `NODE_ENV="production"`, `SocialProviderFactory.getProvider(platform)` checks for required API keys.
- If any required environment variable is missing for a requested live provider, the factory **throws an explicit error** rather than silently falling back to mock publishing.
- In local development (`ENABLE_LIVE_SOCIAL_APIS="false"` / `NODE_ENV="development"`), the factory returns `MockSocialProvider` for safe local testing.

---

## 2. OAuth & Credential Security Architecture

### Zero Client-Side Secret Leakage
- **App Secrets & Client Secrets**: Kept exclusively in server-side environment variables (`FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_SECRET`, `TIKTOK_APP_SECRET`, `YOUTUBE_CLIENT_SECRET`).
- **Access & Refresh Tokens**: Encrypted at rest using **AES-256-GCM** via `src/lib/encryption.ts` using `ENCRYPTION_KEY`. Tokens returned by `/api/social-connections` to the frontend are stripped of raw/encrypted credential values.

### OAuth Workflow Endpoints
1. **Authorization URL Generation**: `/api/oauth/[provider]/authorize?workspaceId=<ID>`
   - Generates OAuth authorization URLs with required scopes.
   - Generates a signed, URL-safe base64 `state` parameter containing `workspaceId`, `provider`, `userId`, and a cryptographically random `nonce`.
   - Sets an HTTP-only CSRF verification cookie (`oauth_state_[provider]`).

2. **OAuth Callback**: `/api/oauth/[provider]/callback`
   - Validates the `state` parameter against the HTTP-only CSRF cookie nonce.
   - Exchanges authorization code for access token (and long-lived token / refresh token where applicable).
   - Encrypts tokens with AES-256-GCM.
   - Upserts connection status into the database with initial health checks and capabilities.

---

## 3. Platform-Specific Audits

### A. Facebook (`FacebookProvider.ts`)
- **API Version**: Meta Graph API v20.0
- **Supported Capabilities**:
  - Image posts (`/photos`)
  - Video posts (`/videos`)
  - Reels (`/video_reels` init & upload finish flow)
  - Carousels / Multi-photo posts (unpublished photos + attached media feed post)
  - Page selection (`pageId` metadata)
- **Unsupported Capabilities**:
  - Page Stories (requires Meta partner permissions)
- **Required Environment Variables**:
  - `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- **Required OAuth Scopes**:
  - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`
- **Retryable Errors**: Code `4` (Application request limit), Code `17` (User request limit), Code `32` (Page request limit), Network timeouts.
- **Non-Retryable Errors**: Code `190` (Invalid/Expired Token), Code `200` (Permissions error), Invalid media parameters.

### B. Instagram (`InstagramProvider.ts`)
- **API Version**: Meta Graph API v20.0
- **Supported Capabilities**:
  - Single Image post (Media Container + `media_publish`)
  - Single Video / Reel post (Media Container + `media_publish`)
  - Carousel post (Multi-item child containers + Parent `CAROUSEL` container + `media_publish`)
- **Unsupported Capabilities**:
  - Text-only posts (Instagram requires at least 1 image or video)
- **Required Environment Variables**:
  - `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`
- **Required OAuth Scopes**:
  - `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`
- **Retryable Errors**: Code `4`, `17`, `32` (Rate limits), Network timeouts.
- **Non-Retryable Errors**: Code `190` (Token expired/revoked), Missing media attachments, Unsupported aspect ratios.

### C. TikTok (`TikTokProvider.ts`)
- **API Version**: TikTok Open API v2
- **Supported Capabilities**:
  - Video publishing via `PULL_FROM_URL` (`/v2/post/publish/video/init/`)
  - Privacy level settings (`PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`)
  - Duet, Comment, and Stitch toggles
- **Unsupported Capabilities**:
  - Image posts, Carousel posts
- **Required Environment Variables**:
  - `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`
- **Required OAuth Scopes**:
  - `user.info.basic`, `video.upload`, `video.publish`
- **Retryable Errors**: Code `40007` / `40008` (Rate limits), Network timeouts.
- **Non-Retryable Errors**: Code `40101` / `40102` (Unauthorized/Expired), Image media payloads (`UNSUPPORTED_MEDIA_TYPE`).

### D. YouTube (`YouTubeProvider.ts`)
- **API Version**: YouTube Data API v3
- **Supported Capabilities**:
  - Video upload / insert (`/youtube/v3/videos?part=snippet,status`)
  - YouTube Shorts detection (via `#shorts` tag or `isShort` metadata)
  - Automatic OAuth token refresh using `refreshCredentials()` when `refreshTokenEnc` is present
- **Unsupported Capabilities**:
  - Image posts, Carousel posts
- **Required Environment Variables**:
  - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`
- **Required OAuth Scopes**:
  - `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`
- **Retryable Errors**: Code `403` Quota Exceeded error, Network timeouts.
- **Non-Retryable Errors**: Code `401` Unauthorized, Missing video URL.

---

## 4. Production Readiness vs. Console Configuration Required

| Platform | Code Implementation Status | Developer Console Configuration Required |
|----------|---------------------------|------------------------------------------|
| **Facebook** | **Production Ready** | Create Meta App, request `pages_manage_posts` & `publish_video` permissions |
| **Instagram** | **Production Ready** | Link IG Business Account to FB Page, complete Meta App Review |
| **TikTok** | **Production Ready** | Register TikTok App in Developer Center, request Direct Post / Content Posting API approval |
| **YouTube** | **Production Ready** | Create Google Cloud Project, enable YouTube Data API v3, configure OAuth Consent Screen |

---

## 5. Verification & Testing

Run full test suite:
```bash
npm test
```
Executes:
- `tests/encryption.test.ts`: AES-256-GCM encryption & persistence security.
- `tests/publishing.test.ts`: Background publishing queue worker & idempotency.
- `tests/providers.test.ts`: Live provider mocks for Facebook, Instagram, TikTok, YouTube, and Mock provider.
