'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import { BarChart3, Eye, Users, ThumbsUp, TrendingUp, RotateCw } from 'lucide-react';

export default function AnalyticsPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = () => {
    setLoading(true);
    const url = isAgencyMode
      ? '/api/analytics?workspaceId=ALL_CLIENTS'
      : `/api/analytics?workspaceId=${currentWorkspace?.id}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAnalytics();
  }, [currentWorkspace, isAgencyMode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-500" /> Normalized Performance Analytics
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Cross-platform metric aggregates and engagement insights across social accounts.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Loading performance metrics...
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-bold uppercase mb-2">
                <span>Impressions</span>
                <Eye className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.summary?.totalImpressions?.toLocaleString() || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-bold uppercase mb-2">
                <span>Unique Reach</span>
                <Users className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.summary?.totalReach?.toLocaleString() || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-bold uppercase mb-2">
                <span>Likes & Reactions</span>
                <ThumbsUp className="w-4 h-4 text-pink-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.summary?.totalLikes?.toLocaleString() || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-bold uppercase mb-2">
                <span>Engagement Rate</span>
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-400">{data?.summary?.engagementRate}%</div>
            </div>
          </div>

          <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-6 overflow-x-auto">
            <h3 className="text-sm font-bold text-white mb-4">Daily Performance Log</h3>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400 uppercase font-bold">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Workspace</th>
                  <th className="py-3 px-3">Platform</th>
                  <th className="py-3 px-3">Impressions</th>
                  <th className="py-3 px-3">Reach</th>
                  <th className="py-3 px-3">Likes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {data?.snapshots?.map((s: any) => (
                  <tr key={s.id} className="hover:bg-neutral-900/50">
                    <td className="py-3 px-3 font-semibold text-white">
                      {new Date(s.date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3 text-amber-400 font-bold">{s.workspace?.name}</td>
                    <td className="py-3 px-3 font-bold text-neutral-300">{s.platform}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{s.impressions}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{s.reach}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{s.likes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
