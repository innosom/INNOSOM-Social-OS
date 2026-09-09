'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FileText,
  Calendar,
  Image as ImageIcon,
  CheckSquare,
  BarChart3,
  ShieldCheck,
  LogOut,
  Sparkles,
  Command,
} from 'lucide-react';
import { WorkspaceSwitcher } from '@/components/switcher/WorkspaceSwitcher';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Clients / Workspaces', href: '/clients', icon: Users },
  { name: 'Content Composer', href: '/content', icon: FileText },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Media Library', href: '/media', icon: ImageIcon },
  { name: 'Approvals', href: '/approvals', icon: CheckSquare },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Connection Health', href: '/health', icon: ShieldCheck },
];

export function Sidebar() {
  const pathname = usePathname();
  const { setIsCmdKOpen } = useWorkspace();

  const handleLogout = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' });
    window.location.href = '/login';
  };

  return (
    <aside className="w-64 bg-neutral-950 border-r border-neutral-800/80 flex flex-col h-screen sticky top-0 z-40 select-none">
      <div className="p-4 border-b border-neutral-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center font-black text-black text-base shadow-lg shadow-amber-500/20">
            IS
          </div>
          <div>
            <h1 className="text-sm font-black text-white tracking-wider">
              INNOSOM <span className="text-amber-500">Social OS</span>
            </h1>
            <p className="text-[10px] text-neutral-500 font-medium">Internal Operations V1</p>
          </div>
        </div>
      </div>

      <div className="p-3 border-b border-neutral-800/80">
        <WorkspaceSwitcher />
      </div>

      <div className="px-3 pt-3">
        <button
          onClick={() => setIsCmdKOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800/80 hover:border-amber-500/30 text-xs text-neutral-400 hover:text-white transition-all"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Switch Client...
          </span>
          <span className="flex items-center text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 font-mono">
            <Command className="w-2.5 h-2.5 mr-0.5" /> K
          </span>
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                isActive
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-neutral-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-neutral-800/80 bg-neutral-950">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-neutral-900/60 hover:bg-neutral-900 text-xs text-neutral-400 hover:text-red-400 border border-neutral-800/50 transition-colors"
        >
          <span className="font-semibold">Sign Out</span>
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
