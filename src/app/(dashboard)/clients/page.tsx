'use client';

import React, { useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import {
  Users,
  Plus,
  Search,
  Star,
  ExternalLink,
  Building2,
  X,
} from 'lucide-react';

export default function ClientsPage() {
  const { workspaces, switchWorkspace, refreshWorkspaces } = useWorkspace();
  const [filter, setFilter] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  const filteredWorkspaces = workspaces.filter((w) =>
    w.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName) return;

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClientName }),
      });

      if (res.ok) {
        setNewClientName('');
        setIsAddModalOpen(false);
        refreshWorkspaces();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" /> Client Workspaces Directory
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Manage agency client workspaces, switch contexts, or configure new brand environments.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 self-start sm:self-center"
        >
          <Plus className="w-4 h-4" /> Add Client Workspace
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Filter client workspaces..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredWorkspaces.map((ws) => (
          <div
            key={ws.id}
            className="bg-neutral-950 border border-neutral-800 hover:border-amber-500/40 rounded-2xl p-5 transition-all flex flex-col justify-between space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {ws.logoUrl ? (
                  <img
                    src={ws.logoUrl}
                    alt=""
                    className="w-12 h-12 rounded-xl object-cover shrink-0 border border-neutral-800"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center font-bold text-amber-500 text-lg shrink-0">
                    {ws.name.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    {ws.name}
                    {ws.isFavorite && <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />}
                  </h3>
                  <span className="text-[11px] text-neutral-500">Slug: {ws.slug}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs bg-neutral-900 border border-neutral-800/80 rounded-xl p-3">
              <div>
                <div className="text-[10px] text-neutral-500 uppercase font-bold">Social Accounts</div>
                <div className="text-sm font-bold text-white">{ws._count?.socialConnections || 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500 uppercase font-bold">Total Posts</div>
                <div className="text-sm font-bold text-white">{ws._count?.contents || 0}</div>
              </div>
            </div>

            <button
              onClick={() => {
                switchWorkspace(ws.id);
                window.location.href = '/dashboard';
              }}
              className="w-full py-2 rounded-xl bg-neutral-900 hover:bg-amber-500 hover:text-black text-amber-400 font-bold text-xs border border-neutral-800 hover:border-amber-500 transition-all flex items-center justify-center gap-1.5"
            >
              <span>Switch to Context</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddClient}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-500" /> Add Client Workspace
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Client Brand Name
              </label>
              <input
                type="text"
                placeholder="e.g. Alpha Industries"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newClientName}
                className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-amber-500 hover:bg-amber-400 disabled:opacity-50"
              >
                Create Workspace
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
