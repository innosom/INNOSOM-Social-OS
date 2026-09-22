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

## Database Architecture & Workflows

INNOSOM Social OS supports both lightweight local development and production-grade PostgreSQL:
- **Local Development**: SQLite (via `prisma/schema.sqlite.prisma`) or PostgreSQL.
- **Production**: PostgreSQL 15+ using versioned migrations (`prisma/schema.prisma`).

See [docs/DEPLOYMENT_POSTGRES.md](docs/DEPLOYMENT_POSTGRES.md) for full production deployment guide and schema performance details.

---

## Local Development & Setup

### Prerequisites
- Node.js 18+ or 20+
- npm
- (Optional) PostgreSQL 15+ if testing production database setup locally

### Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Ensure `.env` is populated (copy from `.env.example` if needed):
   ```env
   DATABASE_URL="file:./dev.db"
   ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
   ```

3. **Initialize Database & Seed Data**:
   - **SQLite Development (Default)**:
     ```bash
     npm run db:push
     npm run db:seed
     ```
   - **PostgreSQL Development / Testing**:
     ```bash
     DATABASE_URL="postgresql://user:pass@localhost:5432/innosom_dev?schema=public" npm run db:migrate:dev
     DATABASE_URL="postgresql://user:pass@localhost:5432/innosom_dev?schema=public" npm run db:seed
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

## Production Deployment Commands

1. **Apply PostgreSQL Migrations**:
   ```bash
   npm run db:migrate:deploy
   ```

2. **Seed Initial Production Data**:
   ```bash
   npm run db:seed
   ```

3. **Build & Start Web Application**:
   ```bash
   npm run build
   npm run start
   ```

4. **Start Background Queue Worker**:
   ```bash
   npm run worker
   ```
