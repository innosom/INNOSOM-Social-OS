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

6. **Production Database & Migration Architecture**:
   - **Local Development**: Supports lightweight zero-dependency SQLite (`DATABASE_URL="file:./dev.db"`).
   - **Production Operation**: Native PostgreSQL database support using versioned Prisma Migrations (`prisma/migrations/`) without reliance on `db push`.
   - **Scalability Indexing**: Composite indexes for background queue/scheduler polling (`Publication(status, scheduledAt)`), workspace filtering, media folder hierarchy, and audit logs at scale.

---

## Local Development & Setup

### Prerequisites
- Node.js 18+ or 20+
- npm
- (Optional) PostgreSQL server (if testing PostgreSQL locally)

### Option A: Local Development with SQLite (Default / Lightweight)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure `.env`**:
   ```env
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
   ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   ```

3. **Initialize SQLite Database & Seed Data**:
   ```bash
   npm run db:push
   npm run db:seed
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   ```

### Option B: Local Development / Testing with PostgreSQL

1. **Configure `.env`**:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/innosom_dev?schema=public"
   JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
   ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   ```

2. **Apply Migrations & Seed Data**:
   ```bash
   npm run db:migrate:deploy
   npm run db:seed
   ```

3. **Run Test Suite**:
   ```bash
   npm test
   ```

---

## Production Deployment & PostgreSQL Instructions

To deploy INNOSOM Social OS into a production environment with PostgreSQL:

1. **Set Environment Variables**:
   ```env
   DATABASE_URL="postgresql://user:password@pg-host:5432/innosom_prod?sslmode=require"
   REDIS_URL="redis://redis-host:6379"
   JWT_SECRET="<generate-secure-32-byte-secret>"
   ENCRYPTION_KEY="<generate-64-character-hex-key>"
   NODE_ENV="production"
   ```

2. **Execute Database Migrations**:
   Run Prisma migrations to create all database tables, foreign key constraints, and performance indexes on a fresh PostgreSQL instance:
   ```bash
   npm run db:migrate:deploy
   ```

3. **Seed Initial Data (Optional for new environment setup)**:
   ```bash
   npm run db:seed
   ```

4. **Build and Start Production Server**:
   ```bash
   npm run build
   npm run start
   ```

5. **Start Background Worker**:
   In a separate process manager (e.g. Systemd, PM2, Docker):
   ```bash
   npm run worker
   ```

---

## Demo Accounts
- Admin: `admin@innosom.com` / `Password123!`
- Manager: `manager@innosom.com` / `Password123!`
- Editor: `editor@innosom.com` / `Password123!`
