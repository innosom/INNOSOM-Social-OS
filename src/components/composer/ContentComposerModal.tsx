'use client';

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import {
  Plus,
  Send,
  Calendar,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  X,
  Facebook,
  Instagram,
  Video,
  Youtube,
  ShieldCheck,
} from 'lucide-react';

interface MediaItem {
  id: string;
  fileName: string;
  publicUrl: string;
  mimeType: string;
}

export function ContentComposerModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { currentWorkspace } = useWorkspace();

  const [title, setTitle] = useState('');
  const [masterCaption, setMasterCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem[]>([]);
  const [availableMedia, setAvailableMedia] = useState<MediaItem[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'FACEBOOK',
    'INSTAGRAM',
  ]);

  const [platformCaptions, setPlatformCaptions] = useState<{ [key: string]: string }>({
    FACEBOOK: '',
    INSTAGRAM: '',
    TIKTOK: '',
    YOUTUBE: '',
  });

  const [isSafetyCheckOpen, setIsSafetyCheckOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'MASTER' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE'>('MASTER');

  useEffect(() => {
    if (isOpen && currentWorkspace) {
      fetch(`/api/media?workspaceId=${currentWorkspace.id}`)
        .then((res) => res.json())
        .then((data) => setAvailableMedia(data.media || []));
    }
  }, [isOpen, currentWorkspace]);

  if (!isOpen) return null;

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
  };

  const handleSaveDraft = async (submitForApproval = false) => {
    if (!currentWorkspace) return;
    setIsSubmitting(true);

    try {
      const payload = {
        workspaceId: currentWorkspace.id,
        title,
        masterCaption,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        submitForApproval,
        platforms: selectedPlatforms.map((p) => ({
          platform: p,
          caption: platformCaptions[p] || masterCaption,
          hashtags: ['#INNOSOM', `#${currentWorkspace.name.replace(/\s+/g, '')}`],
          mediaAssetIds: selectedMedia.map((m) => m.id),
        })),
      };

      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-950">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-500" /> Create New Content
            </h2>
            <p className="text-xs text-neutral-400">
              Workspace:{' '}
              <span className="text-amber-400 font-semibold">
                {currentWorkspace ? currentWorkspace.name : 'Select a client first'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Internal Post Title
              </label>
              <input
                type="text"
                placeholder="e.g. Midterm Examination Announcement..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2">
                Publishing Platforms
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'FACEBOOK', label: 'Facebook', icon: Facebook, color: 'text-blue-500' },
                  { id: 'INSTAGRAM', label: 'Instagram', icon: Instagram, color: 'text-pink-500' },
                  { id: 'TIKTOK', label: 'TikTok', icon: Video, color: 'text-cyan-400' },
                  { id: 'YOUTUBE', label: 'YouTube', icon: Youtube, color: 'text-red-500' },
                ].map((p) => {
                  const Icon = p.icon;
                  const isSelected = selectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${p.color}`} />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex border-b border-neutral-800 space-x-2 mb-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('MASTER')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 transition-colors ${
                    activeTab === 'MASTER'
                      ? 'border-amber-500 text-amber-500'
                      : 'border-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  Master Caption
                </button>
                {selectedPlatforms.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActiveTab(p as any)}
                    className={`pb-2 px-3 text-xs font-bold border-b-2 transition-colors ${
                      activeTab === p
                        ? 'border-amber-500 text-amber-500'
                        : 'border-transparent text-neutral-400 hover:text-white'
                    }`}
                  >
                    {p} Variant
                  </button>
                ))}
              </div>

              {activeTab === 'MASTER' ? (
                <div>
                  <textarea
                    rows={4}
                    placeholder="Write primary post copy here..."
                    value={masterCaption}
                    onChange={(e) => setMasterCaption(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-[11px] text-neutral-500 mt-1">
                    This caption will automatically populate un-customized platform variants.
                  </p>
                </div>
              ) : (
                <div>
                  <textarea
                    rows={4}
                    placeholder={`Tailored caption for ${activeTab}...`}
                    value={platformCaptions[activeTab] || masterCaption}
                    onChange={(e) =>
                      setPlatformCaptions({
                        ...platformCaptions,
                        [activeTab]: e.target.value,
                      })
                    }
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-amber-500" /> Media Attachments
              </label>

              {availableMedia.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto p-1 bg-neutral-950 border border-neutral-800 rounded-xl">
                  {availableMedia.map((media) => {
                    const isSelected = selectedMedia.some((m) => m.id === media.id);
                    return (
                      <div
                        key={media.id}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedMedia(selectedMedia.filter((m) => m.id !== media.id));
                          } else {
                            setSelectedMedia([...selectedMedia, media]);
                          }
                        }}
                        className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                          isSelected
                            ? 'border-amber-500 ring-2 ring-amber-500/20'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={media.publicUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        {isSelected && (
                          <div className="absolute top-1 right-1 bg-amber-500 text-black rounded-full p-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 italic">
                  No media uploaded yet for this workspace. Upload images in Media Library.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-5 border-l border-neutral-800 pl-6">
            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-500" /> Publishing Schedule
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
              <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Platform Variant Preview
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-amber-500">
                  {currentWorkspace?.name.charAt(0)}
                </div>
                <span className="text-xs font-bold text-white truncate">
                  {currentWorkspace?.name}
                </span>
              </div>
              <p className="text-xs text-neutral-300 line-clamp-3">
                {platformCaptions[activeTab] || masterCaption || 'Your post preview will appear here...'}
              </p>
              {selectedMedia.length > 0 && (
                <img
                  src={selectedMedia[0].publicUrl}
                  alt=""
                  className="w-full aspect-video rounded-lg object-cover"
                />
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex justify-between items-center">
          <button
            type="button"
            onClick={() => handleSaveDraft(false)}
            disabled={isSubmitting || !title}
            className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-300 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
          >
            Save Draft
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSaveDraft(true)}
              disabled={isSubmitting || !title || !masterCaption}
              className="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50"
            >
              Submit for Approval
            </button>

            <button
              type="button"
              onClick={() => setIsSafetyCheckOpen(true)}
              disabled={isSubmitting || !title || !masterCaption || selectedPlatforms.length === 0}
              className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-amber-500 hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20 flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> Pre-Publish Confirmation
            </button>
          </div>
        </div>
      </div>

      {isSafetyCheckOpen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Publishing Safety Check</h3>
            </div>
            <p className="text-xs text-neutral-300">
              Please double check target brand context before scheduling to prevent accidental cross-client publishing mistakes:
            </p>

            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 space-y-2 text-xs">
              <div>
                <span className="text-neutral-500">CLIENT:</span>{' '}
                <span className="text-amber-400 font-bold">{currentWorkspace?.name}</span>
              </div>
              <div>
                <span className="text-neutral-500">TARGET PLATFORMS:</span>{' '}
                <span className="text-white font-semibold">{selectedPlatforms.join(', ')}</span>
              </div>
              <div>
                <span className="text-neutral-500">POST TITLE:</span>{' '}
                <span className="text-white font-semibold">{title}</span>
              </div>
              <div>
                <span className="text-neutral-500">MEDIA COUNT:</span>{' '}
                <span className="text-white font-semibold">{selectedMedia.length} attached</span>
              </div>
              <div>
                <span className="text-neutral-500">SCHEDULE:</span>{' '}
                <span className="text-white font-semibold">
                  {scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Immediate Queue'}
                </span>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsSafetyCheckOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-400 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSafetyCheckOpen(false);
                  handleSaveDraft(false);
                }}
                className="px-5 py-2 rounded-xl text-xs font-bold text-black bg-amber-500 hover:bg-amber-400"
              >
                Confirm & Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
