'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import {
  ShieldCheck,
  AlertTriangle,
  RotateCw,
  Plus,
  Trash2,
  X,
  Facebook,
  Instagram,
  Video,
  Youtube,
  Share2,
} from 'lucide-react';

export default function ConnectionHealthPage() {
  const { currentWorkspace, isAgencyMode, workspaces } = useWorkspace();
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect Account Modal State
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [platform, setPlatform] = useState('FACEBOOK');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchConnections = () => {
    setLoading(true);
    const url = isAgencyMode
      ? '/api/social-connections?workspaceId=ALL_CLIENTS'
      : `/api/social-connections?workspaceId=${currentWorkspace?.id}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setConnections(data.connections || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchConnections();
    if (currentWorkspace) {
      setTargetWorkspaceId(currentWorkspace.id);
    } else if (workspaces.length > 0) {
      setTargetWorkspaceId(workspaces[0].id);
    }
  }, [currentWorkspace, isAgencyMode, workspaces]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetWorkspaceId || !platform || !accountName || !accountId) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/social-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: targetWorkspaceId,
          platform,
          accountName,
          accountId,
        }),
      });

      if (res.ok) {
        setAccountName('');
        setAccountId('');
        setIsConnectModalOpen(false);
        fetchConnections();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this social media account?')) return;

    try {
      const res = await fetch(`/api/social-connections?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchConnections();
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
            <ShieldCheck className="w-5 h-5 text-amber-500" /> Token & Connection Health Dashboard
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Real-time proactive monitoring and connection management for agency social media accounts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsConnectModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Connect Social Account
          </button>

          <button
            onClick={fetchConnections}
            className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/40 text-xs font-bold text-white flex items-center gap-2"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-check Health
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Evaluating connection health status...
        </div>
      ) : connections.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connections.map((conn) => {
            const isHealthy = conn.status === 'CONNECTED';
            return (
              <div
                key={conn.id}
                className={`bg-neutral-950 border rounded-2xl p-5 transition-all flex flex-col justify-between space-y-4 ${
                  isHealthy
                    ? 'border-neutral-800 hover:border-emerald-500/40'
                    : 'border-red-500/40 bg-red-500/5'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {conn.avatarUrl ? (
                        <img
                          src={conn.avatarUrl}
                          alt=""
                          className="w-10 h-10 rounded-xl object-cover shrink-0 border border-neutral-800"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-neutral-900 flex items-center justify-center font-bold text-amber-500 shrink-0">
                          {conn.platform.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{conn.accountName}</div>
                        <div className="text-[11px] text-neutral-400">
                          Workspace: <span className="text-amber-400 font-semibold">{conn.workspace?.name}</span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 ${
                        isHealthy
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-red-500/10 text-red-400 border-red-500/30'
                      }`}
                    >
                      {conn.status}
                    </span>
                  </div>

                  {!isHealthy && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-400 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" /> Attention Required
                      </div>
                      <p className="text-[11px] leading-relaxed">{conn.healthErrorMessage}</p>
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-neutral-500 border-t border-neutral-800/80 pt-3 flex justify-between items-center">
                  <span>Checked: {new Date(conn.lastCheckedAt).toLocaleTimeString()}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-neutral-400">{conn.platform}</span>
                    <button
                      onClick={() => handleDisconnect(conn.id)}
                      title="Disconnect Account"
                      className="text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center border border-dashed border-neutral-800 rounded-2xl bg-neutral-950">
          <ShieldCheck className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">No social connections configured in this selection.</p>
        </div>
      )}

      {/* Connect Account Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConnect}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Share2 className="w-5 h-5 text-amber-500" /> Connect Social Account
              </h3>
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Target Client Workspace
              </label>
              <select
                value={targetWorkspaceId}
                onChange={(e) => setTargetWorkspaceId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Social Platform
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'FACEBOOK', label: 'Facebook', icon: Facebook },
                  { id: 'INSTAGRAM', label: 'Instagram', icon: Instagram },
                  { id: 'TIKTOK', label: 'TikTok', icon: Video },
                  { id: 'YOUTUBE', label: 'YouTube', icon: Youtube },
                ].map((p) => {
                  const Icon = p.icon;
                  const isSelected = platform === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatform(p.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Account Display Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Haji Abdi Official Page"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Account ID / Handle
              </label>
              <input
                type="text"
                required
                placeholder="e.g. @hajiabdicollege"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !accountName || !accountId}
                className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-amber-500 hover:bg-amber-400 disabled:opacity-50"
              >
                {submitting ? 'Connecting...' : 'Authorize & Connect'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
