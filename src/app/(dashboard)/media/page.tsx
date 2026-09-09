'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import { Image as ImageIcon, Upload, RotateCw, FileVideo, FileImage } from 'lucide-react';

export default function MediaPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchMedia = () => {
    if (!currentWorkspace && !isAgencyMode) return;
    setLoading(true);
    const url = isAgencyMode
      ? '/api/media?workspaceId=ALL_CLIENTS'
      : `/api/media?workspaceId=${currentWorkspace?.id}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setMedia(data.media || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMedia();
  }, [currentWorkspace, isAgencyMode]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentWorkspace) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspaceId', currentWorkspace.id);

      const res = await fetch('/api/media', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        fetchMedia();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-amber-500" /> Isolated Media Library
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Brand asset storage for images, graphics, and video content.
          </p>
        </div>

        {!isAgencyMode && (
          <label className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer self-start sm:self-center">
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Uploading...' : 'Upload Asset'}</span>
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Loading media assets...
        </div>
      ) : media.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {media.map((item) => {
            const isVideo = item.mimeType?.startsWith('video/');
            return (
              <div
                key={item.id}
                className="bg-neutral-950 border border-neutral-800 hover:border-amber-500/40 rounded-xl overflow-hidden transition-all group flex flex-col justify-between"
              >
                <div className="relative aspect-video bg-neutral-900 overflow-hidden">
                  <img
                    src={item.publicUrl}
                    alt={item.fileName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-2 right-2 p-1 rounded bg-black/60 backdrop-blur-md text-amber-400">
                    {isVideo ? <FileVideo className="w-3.5 h-3.5" /> : <FileImage className="w-3.5 h-3.5" />}
                  </div>
                </div>

                <div className="p-3">
                  <div className="text-xs font-bold text-white truncate">{item.fileName}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">
                    {(item.fileSize / 1024 / 1024).toFixed(2)} MB • {item.folderPath}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center border border-dashed border-neutral-800 rounded-2xl bg-neutral-950">
          <ImageIcon className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">No media assets found in this workspace.</p>
        </div>
      )}
    </div>
  );
}
