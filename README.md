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

## Database Configuration & Dual-Database Strategy

INNOSOM Social OS supports a dual-database architecture:
- **Local Development**: Lightweight SQLite database (`dev.db`) using `prisma/schema.sqlite.prisma`.
- **Production**: Enterprise-grade PostgreSQL database using version-controlled Prisma migrations via `prisma/schema.prisma` (`prisma/migrations/`).

---

## Local Development & Setup (SQLite)

### Prerequisites
- Node.js 18+ or 20+
- npm

### Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Ensure `.env` is populated (copied from `.env.example`):
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

## Production Deployment & PostgreSQL Migration Strategy

In production environments, PostgreSQL is used for high concurrency, durability, and robust indexing.

### 1. Environment Configuration

Set `DATABASE_URL` in your production environment to point to your PostgreSQL instance:
```env
DATABASE_URL="postgresql://<username>:<password>@<host>:<port>/<database_name>?schema=public"
JWT_SECRET="<your-secure-production-32+character-jwt-secret>"
ENCRYPTION_KEY="<your-64-character-hex-encryption-key>"
REDIS_URL="redis://<host>:<port>"
```

### 2. Database Initialization & Migration (Automated)

A fresh PostgreSQL instance can be initialized directly from the repo using standard Prisma migrations:

```bash
# Generate Prisma client for PostgreSQL schema
npm run db:generate

# Deploy versioned database migrations to PostgreSQL
npm run db:migrate:deploy

# Seed initial organization, accounts, and client workspaces
npm run db:seed
```

### 3. Creating New Schema Migrations (Development Mode)

When making schema changes for production:
```bash
# Connect to development PostgreSQL instance and create a migration file
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/innosom_dev" npm run db:migrate:dev
```

### 4. Build & Start Production Services

```bash
# Build Next.js application (runs db:generate automatically)
npm run build

# Start Next.js App Server
npm run start

# Start Async Background Publishing Worker in parallel process
npm run worker
```
