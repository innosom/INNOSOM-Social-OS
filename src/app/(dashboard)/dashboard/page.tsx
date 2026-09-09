'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import {
  Users,
  Share2,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RotateCw,
  Plus,
} from 'lucide-react';
import { ContentComposerModal } from '@/components/composer/ContentComposerModal';

export default function DashboardPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  const fetchDashboard = () => {
    setLoading(true);
    const url = isAgencyMode
      ? '/api/dashboard?workspaceId=ALL_CLIENTS'
      : `/api/dashboard?workspaceId=${currentWorkspace?.id}`;

    fetch(url)
      .then((res) => res.json())
      .then((resData) => {
        setData(resData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboard();
  }, [currentWorkspace, isAgencyMode]);

  const handleRetry = async (pubId: string) => {
    try {
      const res = await fetch(`/api/publications/${pubId}/retry`, { method: 'POST' });
      if (res.ok) {
        fetchDashboard();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-amber-500 font-bold animate-pulse text-sm">
          <RotateCw className="w-5 h-5 animate-spin" /> Loading INNOSOM Command Center...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950 border border-neutral-800 p-6 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-500 mb-1">
            <span>{isAgencyMode ? 'AGENCY COMMAND CENTER' : 'WORKSPACE OVERVIEW'}</span>
          </div>
          <h1 className="text-2xl font-black text-white">
            {isAgencyMode
              ? 'INNOSOM Agency Operations'
              : currentWorkspace?.name}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {isAgencyMode
              ? 'Real-time visibility into all client brands, publication queues, and connection health.'
              : `Managing social operations for ${currentWorkspace?.name}.`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isAgencyMode && (
            <button
              onClick={() => setIsComposerOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create Content
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isAgencyMode ? (
          <>
            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Active Clients</span>
                <Users className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.activeClientsCount || 0}</div>
              <div className="text-[11px] text-neutral-500 mt-1">Workspaces configured</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Social Accounts</span>
                <Share2 className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.socialConnectionsCount || 0}</div>
              <div className="text-[11px] text-neutral-500 mt-1">Connected accounts</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Scheduled Posts</span>
                <Calendar className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.scheduledPublicationsCount || 0}</div>
              <div className="text-[11px] text-neutral-500 mt-1">Ready to publish</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Action Required</span>
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div className="text-2xl font-black text-red-400">
                {(data?.metrics?.failedCount || 0) + (data?.metrics?.expiredConnectionsCount || 0)}
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">Errors / Expired tokens</div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Connected Platforms</span>
                <Share2 className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.connectionsCount || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Scheduled Posts</span>
                <Calendar className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.scheduledCount || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Pending Approvals</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-white">{data?.metrics?.pendingApprovalsCount || 0}</div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 p-5 rounded-2xl">
              <div className="flex justify-between items-center text-neutral-400 mb-2">
                <span className="text-xs font-bold uppercase">Publishing Failures</span>
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div className="text-2xl font-black text-red-400">{data?.metrics?.failuresCount || 0}</div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Publishing Failures & Errors
            </h2>
          </div>

          {((isAgencyMode ? data?.failedPublications : data?.recentFailures) || []).length > 0 ? (
            <div className="space-y-3">
              {((isAgencyMode ? data?.failedPublications : data?.recentFailures) || []).map((pub: any) => (
                <div
                  key={pub.id}
                  className="bg-neutral-900 border border-red-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {pub.contentVariant?.content?.title || 'Untitled Content'}
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Client: <span className="text-amber-400 font-semibold">{pub.socialConnection?.workspace?.name}</span> • Platform: <span className="text-white">{pub.socialConnection?.platform}</span>
                    </div>
                    <div className="text-[11px] text-red-400 mt-1 line-clamp-1 italic">
                      Error: {pub.errorMessage}
                    </div>
                  </div>

                  <button
                    onClick={() => handleRetry(pub.id)}
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 text-xs font-bold shrink-0 flex items-center gap-1 self-start sm:self-center"
                  >
                    <RotateCw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-xs text-neutral-400 font-medium">No publishing errors detected.</p>
            </div>
          )}
        </div>

        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-500" /> Upcoming Publications Queue
            </h2>
          </div>

          {(data?.upcomingPublications || []).length > 0 ? (
            <div className="space-y-3">
              {(data?.upcomingPublications || []).map((pub: any) => (
                <div
                  key={pub.id}
                  className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {pub.contentVariant?.content?.title}
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Client: <span className="text-amber-400 font-semibold">{pub.socialConnection?.workspace?.name || currentWorkspace?.name}</span> • Platform: <span className="text-white">{pub.socialConnection?.platform}</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-neutral-400" />
                      {new Date(pub.scheduledAt).toLocaleString()}
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
                    {pub.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl">
              <Calendar className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
              <p className="text-xs text-neutral-400 font-medium">No posts currently scheduled in queue.</p>
            </div>
          )}
        </div>
      </div>

      <ContentComposerModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        onSuccess={() => fetchDashboard()}
      />
    </div>
  );
}
