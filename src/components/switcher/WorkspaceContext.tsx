'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isFavorite: boolean;
  _count?: {
    socialConnections: number;
    contents: number;
  };
}

interface WorkspaceContextType {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isAgencyMode: boolean;
  isLoading: boolean;
  switchWorkspace: (workspaceId: string | null) => void;
  refreshWorkspaces: () => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isCmdKOpen: boolean;
  setIsCmdKOpen: (open: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCmdKOpen, setIsCmdKOpen] = useState<boolean>(false);

  const refreshWorkspaces = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data.workspaces || []);

        const savedWsId = localStorage.getItem('innosom_active_workspace');
        if (savedWsId && savedWsId !== 'ALL_CLIENTS') {
          const found = data.workspaces.find((w: Workspace) => w.id === savedWsId);
          if (found) {
            setCurrentWorkspace(found);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load workspaces', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshWorkspaces();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCmdKOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const switchWorkspace = (workspaceId: string | null) => {
    if (!workspaceId || workspaceId === 'ALL_CLIENTS') {
      setCurrentWorkspace(null);
      localStorage.setItem('innosom_active_workspace', 'ALL_CLIENTS');
    } else {
      const found = workspaces.find((w) => w.id === workspaceId);
      if (found) {
        setCurrentWorkspace(found);
        localStorage.setItem('innosom_active_workspace', found.id);
      }
    }
    setIsCmdKOpen(false);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        isAgencyMode: currentWorkspace === null,
        isLoading,
        switchWorkspace,
        refreshWorkspaces,
        searchQuery,
        setSearchQuery,
        isCmdKOpen,
        setIsCmdKOpen,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
