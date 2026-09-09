'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import {
  FileText,
  Plus,
  RotateCw,
  User,
} from 'lucide-react';
import { ContentComposerModal } from '@/components/composer/ContentComposerModal';

export default function ContentPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [contents, setContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  const fetchContents = () => {
    setLoading(true);
    const url = isAgencyMode
      ? '/api/content?workspaceId=ALL_CLIENTS'
      : `/api/content?workspaceId=${currentWorkspace?.id}`;

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
    fetchContents();
  }, [currentWorkspace, isAgencyMode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" /> Content Operations Library
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Manage master agency content items, platform variants, and scheduling statuses.
          </p>
        </div>

        {!isAgencyMode && (
          <button
            onClick={() => setIsComposerOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 self-start sm:self-center"
          >
            <Plus className="w-4 h-4" /> Create Content
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Loading content items...
        </div>
      ) : contents.length > 0 ? (
        <div className="space-y-4">
          {contents.map((item) => (
            <div
              key={item.id}
              className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 transition-all space-y-4"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-neutral-800/80 pb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
                    <span className="text-amber-400 font-bold">{item.workspace?.name}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" /> {item.author?.name}
                    </span>
                    <span>•</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                  <h3 className="text-base font-bold text-white">{item.title}</h3>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold self-start md:self-center border ${
                    item.status === 'PUBLISHED'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : item.status === 'FAILED'
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : item.status === 'IN_REVIEW'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-700'
                  }`}
                >
                  {item.status}
                </span>
              </div>

              <p className="text-xs text-neutral-300 line-clamp-2">{item.masterCaption}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                {item.variants?.map((v: any) => (
                  <div
                    key={v.id}
                    className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs space-y-1.5"
                  >
                    <div className="flex justify-between font-bold text-amber-500">
                      <span>{v.platform} Variant</span>
                    </div>
                    <p className="text-neutral-400 line-clamp-2 text-[11px]">{v.caption}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center border border-dashed border-neutral-800 rounded-2xl bg-neutral-950">
          <FileText className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">No content items found for this selection.</p>
        </div>
      )}

      <ContentComposerModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        onSuccess={() => fetchContents()}
      />
    </div>
  );
}
