"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { AppHeader } from '../../components/AppHeader';
import { deleteSessionEbs } from '../../lib/ebsStorage';
import {
  deleteSessionMetadata,
  getSessions,
  subscribeSessions,
  type TempoFlowSession,
} from '../../lib/sessionStorage';
import {
  pauseSessionProcessing,
  resumeSessionProcessing,
} from '../../lib/sessionProcessing';
import {
  isSessionPostProcessComplete,
  shouldTreatSessionAsInProcess,
} from '../../lib/sessionPostProcessing';
import { deleteSessionVideos, getSessionVideo } from '../../lib/videoStorage';

function waitForMediaEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const handleResolve = () => {
      cleanup();
      resolve();
    };
    const handleReject = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, handleResolve);
      target.removeEventListener('error', handleReject);
    };

    target.addEventListener(eventName, handleResolve, { once: true });
    target.addEventListener('error', handleReject, { once: true });
  });
}

async function createVideoThumbnail(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = objectUrl;
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  try {
    await waitForMediaEvent(video, 'loadeddata');

    if (Number.isFinite(video.duration) && video.duration > 0.1) {
      video.currentTime = Math.min(0.1, Math.max(0, video.duration / 2));
      await waitForMediaEvent(video, 'seeked').catch(() => undefined);
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is unavailable.');
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.pause();
    video.src = '';
  }
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function getSessionScore(session: TempoFlowSession) {
  return session.ebsMeta?.finalScore ?? session.analysis?.scores.overall ?? null;
}

function isSessionInProcess(session: TempoFlowSession) {
  return shouldTreatSessionAsInProcess(session);
}

function canResumeSession(session: TempoFlowSession) {
  return session.ebsStatus === 'paused' || session.ebsStatus === 'error' || session.ebsStatus === 'idle';
}

function SessionStatusChip({ session }: { session: TempoFlowSession }) {
  const score = getSessionScore(session);

  if (isSessionPostProcessComplete(session) && score != null) {
    return (
      <div className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
        Score {score}/100
      </div>
    );
  }

  if (isSessionPostProcessComplete(session)) {
    return (
      <div className="rounded-full bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">
        Ready
      </div>
    );
  }

  if (session.ebsStatus === 'paused') {
    return (
      <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
        Processing paused
      </div>
    );
  }

  if (isSessionInProcess(session)) {
    return (
      <div className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700">
        In process
      </div>
    );
  }

  if (session.status === 'error' || session.ebsStatus === 'error') {
    return (
      <div className="rounded-full bg-red-100 px-4 py-2 text-sm font-semibold text-red-700">
        Needs retry
      </div>
    );
  }

  return (
    <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
      Waiting
    </div>
  );
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<TempoFlowSession[]>(() => getSessions());
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const loadingThumbnailIdsRef = useRef<Set<string>>(new Set());
  const thumbnailUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const refresh = () => setSessions(getSessions());
    const unsubscribe = subscribeSessions(refresh);
    refresh();
    return unsubscribe;
  }, []);

  useEffect(() => {
    thumbnailUrlsRef.current = thumbnailUrls;
  }, [thumbnailUrls]);

  useEffect(() => {
    let cancelled = false;
    const sessionIds = new Set(sessions.map((session) => session.id));

    setThumbnailUrls((previous) => {
      const next = { ...previous };
      let changed = false;
      Object.keys(next).forEach((sessionId) => {
        if (sessionIds.has(sessionId)) return;
        delete next[sessionId];
        loadingThumbnailIdsRef.current.delete(sessionId);
        changed = true;
      });
      return changed ? next : previous;
    });

    sessions.forEach((session) => {
      if (thumbnailUrlsRef.current[session.id]) return;
      if (loadingThumbnailIdsRef.current.has(session.id)) return;
      loadingThumbnailIdsRef.current.add(session.id);

      void (async () => {
        try {
          const file = await getSessionVideo(session.id, 'practice');
          if (!file || cancelled) return;
          const thumbnailUrl = await createVideoThumbnail(file);
          if (cancelled) return;
          setThumbnailUrls((previous) => {
            if (previous[session.id] === thumbnailUrl) return previous;
            return { ...previous, [session.id]: thumbnailUrl };
          });
        } catch {
          // Keep the fallback placeholder when a thumbnail cannot be generated.
        } finally {
          loadingThumbnailIdsRef.current.delete(session.id);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [sessions]);

  const handleDelete = async (sessionId: string) => {
    await Promise.all([deleteSessionVideos(sessionId), deleteSessionEbs(sessionId)]);
    deleteSessionMetadata(sessionId);
    setSessions(getSessions());
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#ffffff_0%,#eef6ff_44%,#f8fbff_100%)]">
      <AppHeader primaryHref="/upload" primaryLabel="New Session" />

      <div className="px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-slate-800">Sessions</h1>
          {sessions.length > 0 ? (
            <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
              {sessions.length} saved
            </div>
          ) : null}
        </div>

        {sessions.length > 0 ? (
          <div className="space-y-4">
            {sessions.map((session) => {
              const score = getSessionScore(session);
              const isProcessing = isSessionInProcess(session);
              const canPause = isProcessing;
              const canResume = canResumeSession(session);

              return (
                <div
                  key={session.id}
                  className="rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_40px_rgba(148,163,184,0.08)] transition-all hover:border-blue-300 hover:shadow-[0_20px_48px_rgba(56,189,248,0.12)]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-100 lg:w-52 lg:flex-none">
                      {thumbnailUrls[session.id] ? (
                        <img
                          src={thumbnailUrls[session.id]}
                          alt={`${session.practiceName} thumbnail`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_48%,#f8fafc_100%)]">
                          <svg className="h-10 w-10 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="truncate text-xl font-semibold text-gray-900">
                          {session.practiceName}
                        </h3>
                        <SessionStatusChip session={session} />
                      </div>

                      <p className="mt-2 text-sm text-gray-500">Ref: {session.referenceName}</p>
                      <p className="mt-1 text-xs text-gray-500">Updated {formatUpdatedAt(session.updatedAt)}</p>

                      {isProcessing ? (
                        <p className="mt-3 text-sm text-amber-700">
                          Processing is in progress for this session.
                        </p>
                      ) : null}
                      {session.ebsStatus === 'paused' ? (
                        <p className="mt-3 text-sm text-slate-600">
                          Processing is paused. Resume whenever you want to keep building this session.
                        </p>
                      ) : null}
                      {session.ebsStatus === 'ready' && score != null ? (
                        <p className="mt-3 text-sm text-emerald-700">
                          Latest processed score: <span className="font-semibold">{score}/100</span>
                        </p>
                      ) : null}
                      {session.ebsStatus === 'error' && session.ebsErrorMessage ? (
                        <p className="mt-3 text-sm text-red-700">{session.ebsErrorMessage}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/analysis?session=${session.id}`}
                        className="rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-4 py-2 text-sm font-medium text-white transition-all hover:from-blue-600 hover:to-cyan-500"
                      >
                        Open
                      </Link>

                      {canPause ? (
                        <button
                          onClick={() => pauseSessionProcessing(session.id)}
                          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-all hover:bg-slate-50"
                        >
                          Pause processing
                        </button>
                      ) : null}

                      {canResume ? (
                        <button
                          onClick={() => {
                            void resumeSessionProcessing(session.id);
                          }}
                          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-slate-800"
                        >
                          Resume processing
                        </button>
                      ) : null}

                      <button
                        onClick={() => handleDelete(session.id)}
                        className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-slate-200 bg-white/90 py-16 text-center shadow-[0_16px_40px_rgba(148,163,184,0.08)]">
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-800">No sessions</h3>
            <Link
              href="/upload"
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-5 py-2.5 text-sm font-medium text-white transition-all hover:from-blue-600 hover:to-cyan-500 active:scale-95"
            >
              Start
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
