# INNOSOM Social OS — Architecture & Engineering Specification

## 1. System Overview

**INNOSOM Social OS** is an internal agency social media operations platform built as a modular monolith. It provides INNOSOM team members with a unified command center to manage multiple client workspaces (e.g., Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) and their connected social media channels without logging out or risking cross-client data leakages.

### Architecture Highlights
- **Framework**: Next.js (App Router, React, TypeScript, Tailwind CSS)
- **Database & ORM**: SQLite (Local Dev) / PostgreSQL (Production) with Prisma ORM
- **Async Processing & Queue**: BullMQ + Redis for background publishing jobs, token health checks, and analytics synchronization
- **Security & Authorization**: Server-side derived session context, RBAC (ADMIN, MANAGER, EDITOR, VIEWER), encrypted social API credentials at rest, strictly enforced workspace scoping.
