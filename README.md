# INNOSOM Social OS — Internal Agency Platform MVP

**INNOSOM Social OS** is an agency social media operations command center designed specifically for INNOSOM Tech & Digital Solutions to manage multiple client workspaces (e.g. Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) seamlessly without logging out or risking cross-client data leakages.

---

## Key Product & Architectural Features

1. **Instant Client Switching & Agency Mode**:
   - `Cmd + K` Command Palette & persistent dropdown menu.
   - **Agency Mode ("All Clients")**: High-level agency operations, failed post queue, pending approvals, and account token health.
   - **Workspace Mode**: Context-scoped data views ensuring strict client data isolation.

2. **Content Composer & Multi-Platform Variants**:
   - Master post copy with platform-tailored variant overrides (Facebook, Instagram, TikTok, YouTube).
   - Pre-Publishing Confirmation Safety Check modal to prevent wrong-account posting errors.

3. **Async Background Publishing & Provider Abstraction**:
   - Durable queue architecture (`PublishingWorker.ts`) with idempotency locks, retries, and failure recording.
   - Provider abstraction (`SocialProvider`) with `MockSocialProvider` simulating network latency, rate limits, token expirations, and successful posts in local development.

4. **Token & Connection Health Monitoring**:
   - Real-time warning system detecting expired/revoked OAuth tokens prior to publishing attempts.

5. **Approval Workflow & Audit Logging**:
   - States: `DRAFT`, `IN_REVIEW`, `APPROVED`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`.
   - Immutable audit logging tracking all sensitive agency operational actions.

---

## Database Architecture: Local Dev (SQLite) vs Production (PostgreSQL)

The application architecture supports lightweight SQLite for local development and PostgreSQL for production operation.

- **Local Development**: Uses `prisma/schema.sqlite.prisma` with `npm run db:push`.
- **Production Operation**: Uses `prisma/schema.prisma` with Prisma migrations (`npm run db:migrate:deploy`).

### Database Optimization & Performance Enhancements
- **Scheduler Query Indexing**: Compound index `@@index([status, scheduledAt])` on `Publication` for ultra-fast polling of due publications.
- **Workspace Scoping**: Compound indexes `@@index([workspaceId, status])` and `@@index([workspaceId, createdAt])` on `Content` and `MediaAsset`.
- **Audit Logging at Scale**: Indexes `@@index([organizationId, createdAt])`, `@@index([workspaceId, createdAt])`, and `@@index([userId, createdAt])` on `AuditLog`.
- **Foreign Key Constraints & Cascade Rules**: Foreign key indexes applied to join tables (`Publication`, `ContentVariantMedia`, `Membership`, `Approval`).

---

## Local Development Setup (SQLite)

### Prerequisites
- Node.js 18+ or 20+
- npm

### Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Ensure `.env` is populated for local SQLite:
   ```env
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
   ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   ```

3. **Initialize Database & Seed Data**:
   ```bash
   npm run db:push
   npm run db:seed
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Demo Accounts**:
   - Admin: `admin@innosom.com` / `Password123!`
   - Manager: `manager@innosom.com` / `Password123!`
   - Editor: `editor@innosom.com` / `Password123!`

6. **Run Test Suite**:
   ```bash
   npm test
   ```

---

## Production PostgreSQL Setup & Deployment Instructions

### Environment Variables
Configure `.env` or production environment variables with PostgreSQL details:
```env
DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:5432/<db_name>?schema=public"
REDIS_URL="redis://<redis_host>:6379"
JWT_SECRET="<secure_random_32_byte_string>"
ENCRYPTION_KEY="<64_char_hex_aes_256_key>"
NODE_ENV="production"
```

### Production Initial Database Initialization
To initialize a fresh PostgreSQL production database from the repository:

1. **Execute Production Migrations**:
   ```bash
   npm run db:migrate:deploy
   ```
   This executes all versioned SQL migrations under `prisma/migrations/` sequentially without altering existing database structures or requiring manual editing.

2. **Seed Initial Agency Data (Optional / Initial Setup)**:
   ```bash
   npm run db:seed
   ```

3. **Build & Start Application**:
   ```bash
   npm run build
   npm run start
   ```

4. **Start Background Publishing Worker**:
   ```bash
   npm run worker
   ```

### Schema Changes & Migration Strategy in Production
When making future schema modifications:
1. Update `prisma/schema.prisma` (and matching `prisma/schema.sqlite.prisma`).
2. Generate migration locally against PostgreSQL dev container:
   ```bash
   npm run db:migrate:dev -- --name <descriptive_migration_name>
   ```
3. Commit the generated SQL files in `prisma/migrations/`.
4. In production deployment pipeline, run:
   ```bash
   npm run db:migrate:deploy
   ```
