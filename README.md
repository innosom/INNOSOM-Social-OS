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

## Database Architecture: Local Dev (SQLite) & Production (PostgreSQL)

INNOSOM Social OS uses SQLite for lightweight local development and PostgreSQL for high-concurrency production deployments.

### Database Configuration Overview

| Environment | Provider | Schema File | Migration Strategy | Connection String Format |
|---|---|---|---|---|
| **Local Dev** | SQLite | `prisma/schema.sqlite.prisma` | `npm run db:push` | `file:./dev.db` |
| **Production** | PostgreSQL | `prisma/schema.prisma` | `npm run db:migrate:deploy` | `postgresql://user:pass@host:5432/dbname?schema=public` |

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
   Ensure `.env` is populated (copy from `.env.example` if needed):
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

## Production Deployment & Migration Guide (PostgreSQL)

In production environments, direct `prisma db push` is strictly forbidden to protect database integrity and data consistency. Production must strictly use versioned Prisma migrations via `prisma migrate deploy`.

### Step-by-Step Production Initialisation Process

1. **Configure Production Environment Variables**:
   ```env
   NODE_ENV="production"
   DATABASE_URL="postgresql://postgres:secure_password@prod-db-host:5432/innosom_prod?schema=public"
   JWT_SECRET="your-64-char-hex-or-secure-random-jwt-secret"
   ENCRYPTION_KEY="your-64-char-hex-encryption-key"
   ENABLE_LIVE_SOCIAL_APIS="true"
   ```

2. **Execute Versioned Database Migrations**:
   Run the deployment migration script on a fresh or existing PostgreSQL database instance:
   ```bash
   npm run db:migrate:deploy
   ```

3. **Seed Initial Database (First-time Deployment)**:
   ```bash
   npm run db:seed
   ```

4. **Build and Start Production Server**:
   ```bash
   npm run build
   npm run start
   ```

5. **Start Async Worker Process**:
   ```bash
   npm run worker
   ```

---

## Schema & Performance Optimizations for Production PostgreSQL

The production schema (`prisma/schema.prisma`) includes indexes designed for high throughput and scale:

- **Publication Scheduler**: Index on `(status, scheduledAt)` accelerates queue polling for due publications.
- **Multi-Tenant Isolation**: Index on `Workspace(organizationId)` and `SocialConnection(workspaceId, status)` ensures fast workspace context switches and connection status checks.
- **Content & Workflow**: Compound index on `Content(workspaceId, status)` optimizes dashboard filtering for pending approvals and drafts.
- **Audit Logging**: Indexes on `(organizationId, createdAt)` and `(userId, createdAt)` ensure high-volume audit logs remain queryable as operational data scales.
