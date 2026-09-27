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

6. **Dual Database & Production Migration Architecture**:
   - **Production**: Managed PostgreSQL with versioned Prisma migrations, foreign key cascading rules, and query indexes optimized for background scheduling and audit logging at scale.
   - **Development**: Preserves zero-dependency SQLite local development workflow.

---

## Local Development & Setup

### Prerequisites
- Node.js 18+ or 20+
- npm

### SQLite Local Development

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

---

## Production PostgreSQL Deployment

### Database Commands

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run db:migrate:deploy` | `prisma migrate deploy --schema=prisma/schema.prisma` | Applies versioned PostgreSQL migrations in production. |
| `npm run db:migrate:dev` | `prisma migrate dev --schema=prisma/schema.prisma` | Generates new PostgreSQL migration files during development. |
| `npm run db:push` | `prisma db push --schema=prisma/schema.sqlite.prisma` | Local SQLite database schema sync. |
| `npm run db:seed` | `tsx prisma/seed.ts` | Seeds initial workspaces, users, and social connections. |

For detailed deployment instructions, indexing specs, and production architecture, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Verification & Test Suite

Run full automated test suite (includes encryption security, worker idempotency, social providers, and PostgreSQL verification suite):
```bash
npm test
```
Build production application:
```bash
npm run build
```
