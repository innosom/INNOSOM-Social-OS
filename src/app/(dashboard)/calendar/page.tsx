'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/switcher/WorkspaceContext';
import { Calendar as CalendarIcon, RotateCw, Clock } from 'lucide-react';

export default function CalendarPage() {
  const { currentWorkspace, isAgencyMode } = useWorkspace();
  const [contents, setContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const days = Array.from({ length: 28 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-6 rounded-2xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-amber-500" /> Agency Content Calendar
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Visual calendar schedule of all upcoming and published client content.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-amber-500 font-bold flex justify-center items-center gap-2">
          <RotateCw className="w-4 h-4 animate-spin" /> Loading schedule...
        </div>
      ) : (
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-6 overflow-x-auto">
          <div className="grid grid-cols-7 gap-px bg-neutral-800 rounded-xl overflow-hidden min-w-[700px]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="bg-neutral-900 p-3 text-center text-xs font-bold text-neutral-400 uppercase tracking-wider"
              >
                {day}
              </div>
            ))}

            {days.map((day) => {
              const dayContents = contents.filter((c) => {
                const date = new Date(c.createdAt);
                return date.getDate() % 28 === day % 28;
              });

              return (
                <div
                  key={day}
                  className="bg-neutral-950 p-2 min-h-[110px] flex flex-col justify-between hover:bg-neutral-900/50 transition-colors"
                >
                  <span className="text-[10px] font-bold text-neutral-500 self-end">{day}</span>

                  <div className="space-y-1">
                    {dayContents.slice(0, 2).map((item) => (
                      <div
                        key={item.id}
                        className="bg-neutral-900 border border-neutral-800 rounded p-1.5 text-[10px] truncate"
                      >
                        <div className="font-bold text-amber-400 truncate">{item.title}</div>
                        <div className="text-neutral-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{item.workspace?.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
