'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import { ShieldCheck, AlertTriangle, RotateCw } from 'lucide-react';

export default function ConnectionHealthPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, [currentWorkspace, isAgencyMode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" /> Token & Connection Health Dashboard
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Real-time proactive monitoring of social media platform API tokens and authorization states.
          </p>
        </div>

        <button
          onClick={fetchConnections}
          className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/40 text-xs font-bold text-white flex items-center gap-2 self-start sm:self-center"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-check Token Health
        </button>
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
                  <span className="font-bold text-neutral-400">{conn.platform}</span>
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
    </div>
  );
}
