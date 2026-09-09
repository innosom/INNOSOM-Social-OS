'use client';

import React from 'react';
import { WorkspaceProvider } from '@/components/switcher/WorkspaceContext';
import { Sidebar } from '@/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <div className="flex min-h-screen bg-neutral-900 text-neutral-100 font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  );
}
