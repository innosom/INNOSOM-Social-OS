'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import { CheckSquare, RotateCw, CheckCircle2, XCircle } from 'lucide-react';

export default function ApprovalsPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [contents, setContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInReviewContents = () => {
    setLoading(true);
    const url = isAgencyMode
      ? '/api/content?workspaceId=ALL_CLIENTS&status=IN_REVIEW'
      : `/api/content?workspaceId=${currentWorkspace?.id}&status=IN_REVIEW`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setContents(data.contents || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchInReviewContents();
  }, [currentWorkspace, isAgencyMode]);

  const handleDecision = async (contentId: string, action: 'APPROVE' | 'REQUEST_CHANGES') => {
    try {
      const res = await fetch('/api/content/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId,
          action,
          comment: action === 'REQUEST_CHANGES' ? 'Please adjust post copy date.' : 'Approved for scheduling.',
        }),
      });

      if (res.ok) {
        fetchInReviewContents();
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
            <CheckSquare className="w-5 h-5 text-amber-500" /> Pending Approvals Center
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Review submitted client posts, request copy changes, or grant publishing clearance.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Loading pending approvals...
        </div>
      ) : contents.length > 0 ? (
        <div className="space-y-4">
          {contents.map((item) => (
            <div
              key={item.id}
              className="bg-neutral-950 border border-neutral-800 rounded-2xl p-6 transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2 min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <span className="text-amber-400 font-bold">{item.workspace?.name}</span>
                  <span>•</span>
                  <span>Author: {item.author?.name}</span>
                </div>
                <h3 className="text-base font-bold text-white">{item.title}</h3>
                <p className="text-xs text-neutral-300 line-clamp-3 bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  {item.masterCaption}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                <button
                  onClick={() => handleDecision(item.id, 'REQUEST_CHANGES')}
                  className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" /> Request Changes
                </button>
                <button
                  onClick={() => handleDecision(item.id, 'APPROVE')}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow-lg shadow-amber-500/20 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve Post
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center border border-dashed border-neutral-800 rounded-2xl bg-neutral-950">
          <CheckSquare className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">No posts currently waiting for approval.</p>
        </div>
      )}
    </div>
  );
}
