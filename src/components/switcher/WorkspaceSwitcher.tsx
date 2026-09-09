'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from './WorkspaceContext';
import {
  Building2,
  ChevronDown,
  Search,
  Star,
  Check,
  Command,
  Globe,
  X,
} from 'lucide-react';

export function WorkspaceSwitcher() {
  const {
    workspaces,
    currentWorkspace,
    isAgencyMode,
    switchWorkspace,
    isCmdKOpen,
    setIsCmdKOpen,
  } = useWorkspace();

  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredWorkspaces = workspaces.filter((w) =>
    w.name.toLowerCase().includes(filter.toLowerCase())
  );

  const favoriteWorkspaces = filteredWorkspaces.filter((w) => w.isFavorite);
  const otherWorkspaces = filteredWorkspaces.filter((w) => !w.isFavorite);

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-amber-500/50 transition-all text-left w-64 shadow-sm"
        >
          <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 overflow-hidden">
            {isAgencyMode ? (
              <Building2 className="w-4 h-4 text-amber-500" />
            ) : currentWorkspace?.logoUrl ? (
              <img
                src={currentWorkspace.logoUrl}
                alt={currentWorkspace.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-amber-500 font-bold text-xs">
                {currentWorkspace?.name.charAt(0)}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-neutral-400 tracking-wider uppercase">
              {isAgencyMode ? 'AGENCY MODE' : 'CLIENT WORKSPACE'}
            </div>
            <div className="text-sm font-bold text-white truncate">
              {isAgencyMode ? 'All Clients (Agency)' : currentWorkspace?.name}
            </div>
          </div>

          <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-80 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden p-2">
            <div className="relative mb-2">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search clients... (Cmd+K)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1">
              <button
                onClick={() => {
                  switchWorkspace(null);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                  isAgencyMode
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold'
                    : 'text-neutral-300 hover:bg-neutral-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-amber-500" />
                  <span>All Clients (Agency Mode)</span>
                </div>
                {isAgencyMode && <Check className="w-4 h-4 text-amber-500" />}
              </button>

              <div className="my-1 border-t border-neutral-800/60" />

              {favoriteWorkspaces.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-500" /> Favorites
                  </div>
                  {favoriteWorkspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        switchWorkspace(ws.id);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                        currentWorkspace?.id === ws.id
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold'
                          : 'text-neutral-300 hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {ws.logoUrl ? (
                          <img
                            src={ws.logoUrl}
                            alt=""
                            className="w-5 h-5 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-300 font-bold shrink-0">
                            {ws.name.charAt(0)}
                          </div>
                        )}
                        <span className="truncate">{ws.name}</span>
                      </div>
                      {currentWorkspace?.id === ws.id && (
                        <Check className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {otherWorkspaces.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                    All Clients
                  </div>
                  {otherWorkspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        switchWorkspace(ws.id);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                        currentWorkspace?.id === ws.id
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold'
                          : 'text-neutral-300 hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {ws.logoUrl ? (
                          <img
                            src={ws.logoUrl}
                            alt=""
                            className="w-5 h-5 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-300 font-bold shrink-0">
                            {ws.name.charAt(0)}
                          </div>
                        )}
                        <span className="truncate">{ws.name}</span>
                      </div>
                      {currentWorkspace?.id === ws.id && (
                        <Check className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isCmdKOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center pt-20 p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center px-4 border-b border-neutral-800">
              <Search className="w-5 h-5 text-amber-500 mr-3" />
              <input
                type="text"
                autoFocus
                placeholder="Type a client name to switch instantly..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-transparent py-4 text-sm text-white placeholder-neutral-500 focus:outline-none"
              />
              <button
                onClick={() => setIsCmdKOpen(false)}
                className="p-1 rounded text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              <button
                onClick={() => switchWorkspace(null)}
                className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-colors ${
                  isAgencyMode
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'text-neutral-300 hover:bg-neutral-800/70'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">All Clients (Agency Mode)</div>
                    <div className="text-xs text-neutral-400">View agency-wide operations</div>
                  </div>
                </div>
              </button>

              <div className="px-3 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                Workspaces
              </div>

              {filteredWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-colors ${
                    currentWorkspace?.id === ws.id
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : 'text-neutral-300 hover:bg-neutral-800/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {ws.logoUrl ? (
                      <img
                        src={ws.logoUrl}
                        alt=""
                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center font-bold text-amber-500 shrink-0">
                        {ws.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{ws.name}</div>
                      <div className="text-xs text-neutral-400 flex items-center gap-2">
                        <span>{ws._count?.socialConnections || 0} Accounts</span>
                        <span>•</span>
                        <span>{ws._count?.contents || 0} Posts</span>
                      </div>
                    </div>
                  </div>
                  {currentWorkspace?.id === ws.id && (
                    <Check className="w-5 h-5 text-amber-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <div className="p-3 bg-neutral-950 border-t border-neutral-800 flex justify-between items-center text-xs text-neutral-500">
              <span>Navigation: Use mouse or click client</span>
              <span className="flex items-center gap-1">
                <Command className="w-3 h-3" /> + K to toggle
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
