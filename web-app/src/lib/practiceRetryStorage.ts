"use client";

import { deleteVideo, getVideo, storeVideo } from "./videoStorage";

export type PracticeRetryScope = "segment" | "move";

export type PracticeRetryTarget = {
  scope: PracticeRetryScope;
  sessionId: string;
  segmentIndex: number;
  moveIndex?: number | null;
};

export type PracticeRetryTakeMeta = {
  id: string;
  scope: PracticeRetryScope;
  sessionId: string;
  segmentIndex: number;
  moveIndex: number | null;
  fileName: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  updatedAt: string;
};

const PRACTICE_RETRY_METAS_KEY = "tempoflow.practice-retry-metas";

function canUseStorage() {
  return typeof window !== "undefined";
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildTargetSlug(target: PracticeRetryTarget) {
  return `${target.sessionId}:${target.scope}:${target.segmentIndex}:${target.moveIndex ?? "all"}`;
}

function buildRetryVideoKey(target: PracticeRetryTarget) {
  return `retry-take:${buildTargetSlug(target)}`;
}

function readRetryMetas(): PracticeRetryTakeMeta[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(PRACTICE_RETRY_METAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PracticeRetryTakeMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRetryMetas(metas: PracticeRetryTakeMeta[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PRACTICE_RETRY_METAS_KEY, JSON.stringify(metas));
}

export function listSessionPracticeRetryTakes(sessionId: string): PracticeRetryTakeMeta[] {
  return readRetryMetas()
    .filter((meta) => meta.sessionId === sessionId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getPracticeRetryTakeMeta(target: PracticeRetryTarget): PracticeRetryTakeMeta | null {
  return readRetryMetas().find((meta) => buildTargetSlug(meta) === buildTargetSlug(target)) ?? null;
}

export async function storePracticeRetryTake(
  target: PracticeRetryTarget,
  file: File,
): Promise<PracticeRetryTakeMeta> {
  const now = new Date().toISOString();
  const existing = getPracticeRetryTakeMeta(target);
  const nextMeta: PracticeRetryTakeMeta = {
    id: existing?.id ?? makeId(),
    scope: target.scope,
    sessionId: target.sessionId,
    segmentIndex: target.segmentIndex,
    moveIndex: target.moveIndex ?? null,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const nextMetas = [
    nextMeta,
    ...readRetryMetas().filter((meta) => buildTargetSlug(meta) !== buildTargetSlug(target)),
  ];
  writeRetryMetas(nextMetas);
  await storeVideo(buildRetryVideoKey(target), file);
  return nextMeta;
}

export async function getPracticeRetryTakeFile(target: PracticeRetryTarget): Promise<File | null> {
  return getVideo(buildRetryVideoKey(target));
}

export async function deletePracticeRetryTake(target: PracticeRetryTarget): Promise<void> {
  writeRetryMetas(readRetryMetas().filter((meta) => buildTargetSlug(meta) !== buildTargetSlug(target)));
  await deleteVideo(buildRetryVideoKey(target));
}
