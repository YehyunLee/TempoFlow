"use client";

import { Suspense, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

import { buildAnalysisSummary } from '../../lib/analysis';
import { analyzeVideoPoses } from '../../lib/poseAnalysis';
import {
  getAnalysisMode,
  getCurrentSessionId,
  getSession,
  setCurrentSessionId,
  TempoFlowSession,
  updateSession,
} from '../../lib/sessionStorage';
import { getSessionVideo } from '../../lib/videoStorage';
import { loadSam3OverlayFrames, saveSam3OverlayFrames } from '../../lib/sam3OverlayStorage';
import { generateYoloOverlayFrames } from '../../lib/yoloOverlayGenerator';
import { loadYoloOverlayFrames, saveYoloOverlayFrames } from '../../lib/yoloOverlayStorage';

const PoseOverlay = dynamic(() => import('../../components/PoseOverlay'), { ssr: false });
const RoboflowVideoOverlay = dynamic(() => import('../../components/RoboflowVideoOverlay'), { ssr: false });

function AnalysisPageContent() {
  const searchParams = useSearchParams();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState<string | null>(null);
  const [userVideoUrl, setUserVideoUrl] = useState<string | null>(null);
  const [session, setSession] = useState<TempoFlowSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [analysisStatus, setAnalysisStatus] = useState('Loading your local session...');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [overlayMethod, setOverlayMethod] = useState<'pose-fill' | 'yolo-seg' | 'sam3-roboflow'>('pose-fill');

  // YOLO local overlay generation state
  type YoloGenStatus = 'idle' | 'processing-ref' | 'processing-practice' | 'ready' | 'error';
  const [yoloStatus, setYoloStatus] = useState<YoloGenStatus>('idle');
  const [yoloStatusMsg, setYoloStatusMsg] = useState('');
  const [yoloRefFrames, setYoloRefFrames] = useState(0);
  const [yoloPracFrames, setYoloPracFrames] = useState(0);
  const [yoloRefTotal, setYoloRefTotal] = useState(0);
  const [yoloPracTotal, setYoloPracTotal] = useState(0);
  const yoloRefFrameCacheRef = useRef<string[]>([]);
  const yoloPracFrameCacheRef = useRef<string[]>([]);
  const [yoloFrameVersion, setYoloFrameVersion] = useState(0);

  // SAM 3 WebRTC video-file processing state
  type Sam3GenStatus = 'idle' | 'processing-ref' | 'processing-practice' | 'ready' | 'error';
  const [sam3Status,        setSam3Status]        = useState<Sam3GenStatus>('idle');
  const [sam3StatusMsg,     setSam3StatusMsg]      = useState('');
  const [sam3RefProgress,   setSam3RefProgress]    = useState(0);   // upload %
  const [sam3PracProgress,  setSam3PracProgress]   = useState(0);
  const [sam3RefFrames,     setSam3RefFrames]      = useState(0);   // frames received
  const [sam3PracFrames,    setSam3PracFrames]     = useState(0);
  const refFrameCacheRef    = useRef<string[]>([]);
  const pracFrameCacheRef   = useRef<string[]>([]);
  // bump this to re-render the overlay components after generation
  const [sam3FrameVersion,  setSam3FrameVersion]   = useState(0);
  
  const referenceVideoRef = useRef<HTMLVideoElement>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const analysisMode = getAnalysisMode();
  
  useEffect(() => {
    const sessionId = searchParams.get('session') ?? getCurrentSessionId();
    if (!sessionId) {
      setPageError('No local session was found. Upload a reference and practice clip first.');
      setLoadingSession(false);
      return;
    }

    let referenceUrlToCleanup: string | null = null;
    let practiceUrlToCleanup: string | null = null;

    const loadSession = async () => {
      try {
        const nextSession = getSession(sessionId);
        if (!nextSession) {
          setPageError('That local session no longer exists. Please upload the videos again.');
          setLoadingSession(false);
          return;
        }

        const [referenceFile, practiceFile] = await Promise.all([
          getSessionVideo(sessionId, 'reference'),
          getSessionVideo(sessionId, 'practice'),
        ]);

        if (!referenceFile || !practiceFile) {
          setPageError('The local video files for this session were not found.');
          setLoadingSession(false);
          return;
        }

        setCurrentSessionId(sessionId);
        setSession(nextSession);
        referenceUrlToCleanup = URL.createObjectURL(referenceFile);
        practiceUrlToCleanup = URL.createObjectURL(practiceFile);
        setReferenceVideoUrl(referenceUrlToCleanup);
        setUserVideoUrl(practiceUrlToCleanup);

        try {
          const [savedYoloRef, savedYoloPrac] = await Promise.all([
            loadYoloOverlayFrames({ sessionId, role: 'reference' }),
            loadYoloOverlayFrames({ sessionId, role: 'practice' }),
          ]);
          if (savedYoloRef && savedYoloPrac) {
            yoloRefFrameCacheRef.current = savedYoloRef;
            yoloPracFrameCacheRef.current = savedYoloPrac;
            setYoloRefFrames(savedYoloRef.length);
            setYoloPracFrames(savedYoloPrac.length);
            setYoloRefTotal(savedYoloRef.length);
            setYoloPracTotal(savedYoloPrac.length);
            setYoloStatus('ready');
            setYoloFrameVersion((v) => v + 1);
          }
        } catch (err) {
          console.warn('Failed to restore saved YOLO overlay frames:', err);
        }

        // Attempt to restore previously generated SAM 3 overlay frames from IndexedDB.
        // These are stored as Blob URLs and can be replayed without re-running Roboflow.
        try {
          const [refFrames, pracFrames] = await Promise.all([
            loadSam3OverlayFrames({ sessionId, role: 'reference' }),
            loadSam3OverlayFrames({ sessionId, role: 'practice' }),
          ]);
          if (refFrames && pracFrames) {
            refFrameCacheRef.current = refFrames;
            pracFrameCacheRef.current = pracFrames;
            setSam3RefFrames(refFrames.length);
            setSam3PracFrames(pracFrames.length);
            setSam3Status('ready');
            setSam3FrameVersion((v) => v + 1);
        }
      } catch (err) {
          console.warn('Failed to restore saved SAM 3 overlays:', err);
        }
      } catch (error) {
        console.error('Failed to load local session:', error);
        setPageError('Failed to load the saved session from this device.');
      } finally {
        setLoadingSession(false);
      }
    };

    loadSession();

    return () => {
      if (referenceUrlToCleanup?.startsWith('blob:')) URL.revokeObjectURL(referenceUrlToCleanup);
      if (practiceUrlToCleanup?.startsWith('blob:')) URL.revokeObjectURL(practiceUrlToCleanup);
    };
  }, [searchParams]);

  useEffect(() => {
    const shouldAnalyze =
      session &&
      referenceVideoUrl &&
      userVideoUrl &&
      !pageError &&
      (!session.analysis || session.status !== 'analyzed');

    if (!shouldAnalyze) {
      return;
    }

    let cancelled = false;

    const runAnalysis = async () => {
      try {
        updateSession(session.id, { status: 'analyzing', errorMessage: undefined });
        setAnalysisProgress(5);
        setAnalysisStatus('Analyzing reference performance...');

        const referenceResult = await analyzeVideoPoses(referenceVideoUrl, (progress, label) => {
          if (cancelled) return;
          setAnalysisProgress(Math.round(progress * 40));
          setAnalysisStatus(label);
        });

        if (cancelled) return;

        setAnalysisStatus('Analyzing your practice clip...');
        const practiceResult = await analyzeVideoPoses(userVideoUrl, (progress, label) => {
          if (cancelled) return;
          setAnalysisProgress(40 + Math.round(progress * 40));
          setAnalysisStatus(label);
        });

        if (referenceResult.samples.length < 6 || practiceResult.samples.length < 6) {
          throw new Error('Not enough pose frames were detected. Try clips with a clearer full-body view.');
        }

        setAnalysisStatus('Comparing timing and movement...');
        setAnalysisProgress(88);
        const summary = buildAnalysisSummary({
          reference: referenceResult.samples,
          practice: practiceResult.samples,
          referenceDurationSec: referenceResult.durationSec,
          practiceDurationSec: practiceResult.durationSec,
        });

        let nextSummary = summary;

        if (analysisMode === 'api') {
          setAnalysisStatus('Requesting AI coaching summary...');

          try {
            const response = await fetch('/api/coach', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: session.id, summary }),
            });

            if (response.ok) {
              const data = await response.json();
              if (Array.isArray(data.insights) && data.insights.length > 0) {
                nextSummary = {
                  ...summary,
                  insights: summary.insights.map((insight, index) => ({
                    ...insight,
                    body: data.insights[index] ?? insight.body,
                  })),
                };
              }
            }
          } catch (error) {
            console.warn('API coaching summary failed, using local coaching text.', error);
          }
        }

        if (cancelled) return;

        const updatedSession = updateSession(session.id, {
          status: 'analyzed',
          analysis: nextSummary,
          errorMessage: undefined,
        });

        setSession(updatedSession ?? { ...session, status: 'analyzed', analysis: nextSummary });
        setDuration(nextSummary.durationSec);
        setAnalysisProgress(100);
        setAnalysisStatus('Analysis ready.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analysis failed.';
        updateSession(session.id, { status: 'error', errorMessage: message });
        setSession((currentSession) =>
          currentSession ? { ...currentSession, status: 'error', errorMessage: message } : currentSession,
        );
        setPageError(message);
      }
    };

    runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [analysisMode, pageError, referenceVideoUrl, session, userVideoUrl]);

  useEffect(() => {
    if (session?.analysis?.durationSec) {
      setDuration(session.analysis.durationSec);
    }
  }, [session]);

  const togglePlayPause = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    
    if (referenceVideoRef.current && userVideoRef.current) {
        if (nextState) {
        referenceVideoRef.current.play().catch((error) => console.error('Play error:', error));
        userVideoRef.current.play().catch((error) => console.error('Play error:', error));
        } else {
            referenceVideoRef.current.pause();
            userVideoRef.current.pause();
        }
    }
  };

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        if (referenceVideoRef.current) {
          setCurrentTime(referenceVideoRef.current.currentTime);
          if (referenceVideoRef.current.ended) {
            setIsPlaying(false);
            setCurrentTime(0);
          }
        }
      }, 100);
    } else if (progressInterval.current) {
      clearInterval(progressInterval.current);
    }

    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, [isPlaying]);

  const jumpToTime = (timeSec: number) => {
    if (!referenceVideoRef.current || !userVideoRef.current) return;
    referenceVideoRef.current.currentTime = timeSec;
    userVideoRef.current.currentTime = timeSec;
    setCurrentTime(timeSec);
  };

  /** Process both videos through Roboflow SAM 3 WebRTC pipeline */
  const generateSam3Overlays = async () => {
    if (!referenceVideoUrl || !userVideoUrl) return;
    if (sam3Status === 'processing-ref' || sam3Status === 'processing-practice') return;
    if (!session?.id) return;

    refFrameCacheRef.current  = [];
    pracFrameCacheRef.current = [];
    setSam3RefFrames(0);
    setSam3PracFrames(0);
    setSam3RefProgress(0);
    setSam3PracProgress(0);

    const VIDEO_OUTPUT = 'label_visualization';

    const processVideo = async (
      blobUrl: string,
      onFrame: (src: string) => void,
      onUpload: (pct: number) => void,
    ) => {
      const { connectors, webrtc } = await import('@roboflow/inference-sdk');

      // Fetch the blob: URL → File object so the SDK can handle upload
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      const file = new File([blob], 'video.mp4', { type: blob.type || 'video/mp4' });

      const connector = connectors.withProxyUrl('/api/init-webrtc');

      await new Promise<void>((resolve, reject) => {
        let framesSeen = 0;
        let lastActivity = performance.now();
        let loggedKeys = false;
        const IDLE_MS = 8000;
        const pollId = window.setInterval(() => {
          const quietFor = performance.now() - lastActivity;
          if (framesSeen > 0 && quietFor >= IDLE_MS) {
            window.clearInterval(pollId);
            resolve();
          }
        }, 1000);

        webrtc
          .useVideoFile({
            file,
            connector,
            wrtcParams: {
              // workspace / workflowId are injected server-side by /api/init-webrtc
              workspaceName: '__proxy__',
              workflowId: '__proxy__',
              streamOutputNames: [],
              dataOutputNames: [VIDEO_OUTPUT, 'model_predictions'],
              processingTimeout: 3600,
              realtimeProcessing: false,
            },
            onData: (data: Record<string, unknown>) => {
              lastActivity = performance.now();
              const serialized = data.serialized_output_data as
                | Record<string, { value?: string }>
                | undefined;
              if (!loggedKeys) {
                loggedKeys = true;
                // Helpful single log to inspect workflow outputs.
                // eslint-disable-next-line no-console
                console.log(
                  'SAM3 onData serialized_output_data keys:',
                  Object.keys(serialized ?? {}),
                );
              }
              const viz = serialized?.[VIDEO_OUTPUT];
              if (viz?.value) {
                framesSeen += 1;
                onFrame(`data:image/jpeg;base64,${viz.value}`);
              }
            },
            onUploadProgress: (sent: number, total: number) => {
              lastActivity = performance.now();
              onUpload(Math.round((sent / total) * 100));
            },
            onComplete: () => {
              window.clearInterval(pollId);
              resolve();
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .catch((err: unknown) => {
            window.clearInterval(pollId);
            reject(err);
          });
      });
    };

    try {
      // ── Reference video ───────────────────────────────────────────────────
      setSam3Status('processing-ref');
      setSam3StatusMsg('Uploading reference video…');

      await processVideo(
        referenceVideoUrl,
        (src) => {
          refFrameCacheRef.current.push(src);
          setSam3RefFrames(refFrameCacheRef.current.length);
        },
        (pct) => {
          setSam3RefProgress(pct);
          if (pct === 100) setSam3StatusMsg('Roboflow processing reference…');
        },
      );

      // Persist reference overlay frames for revisit.
      try {
        await saveSam3OverlayFrames({
          sessionId: session.id,
          role: 'reference',
          framesDataUrl: refFrameCacheRef.current,
        });
      } catch (err) {
        console.warn('Failed to save reference SAM 3 overlay frames:', err);
      }

      // ── Practice video ────────────────────────────────────────────────────
      setSam3Status('processing-practice');
      setSam3StatusMsg('Uploading practice video…');

      await processVideo(
        userVideoUrl,
        (src) => {
          pracFrameCacheRef.current.push(src);
          setSam3PracFrames(pracFrameCacheRef.current.length);
        },
        (pct) => {
          setSam3PracProgress(pct);
          if (pct === 100) setSam3StatusMsg('Roboflow processing practice…');
        },
      );

      // Persist practice overlay frames for revisit.
      try {
        await saveSam3OverlayFrames({
          sessionId: session.id,
          role: 'practice',
          framesDataUrl: pracFrameCacheRef.current,
        });
      } catch (err) {
        console.warn('Failed to save practice SAM 3 overlay frames:', err);
      }

      setSam3Status('ready');
      setSam3StatusMsg('');
      setSam3FrameVersion(v => v + 1);
    } catch (err) {
      console.error('SAM 3 generation error:', err);
      setSam3Status('error');
      setSam3StatusMsg(err instanceof Error ? err.message : 'SAM 3 overlay generation failed.');
    }
  };

  const generateYoloOverlays = async () => {
    if (!referenceVideoUrl || !userVideoUrl || !session?.id) return;
    if (yoloStatus === 'processing-ref' || yoloStatus === 'processing-practice') return;

    yoloRefFrameCacheRef.current = [];
    yoloPracFrameCacheRef.current = [];
    setYoloRefFrames(0);
    setYoloPracFrames(0);
    setYoloRefTotal(0);
    setYoloPracTotal(0);

    try {
      setYoloStatus('processing-ref');
      setYoloStatusMsg('Generating reference YOLO overlay locally…');

      const referenceFrames = await generateYoloOverlayFrames({
        videoUrl: referenceVideoUrl,
        color: '#00FF00',
        onProgress: (completed, total) => {
          setYoloRefFrames(completed);
          setYoloRefTotal(total);
        },
      });
      yoloRefFrameCacheRef.current = referenceFrames;
      await saveYoloOverlayFrames({
        sessionId: session.id,
        role: 'reference',
        framesDataUrl: referenceFrames,
      });

      setYoloStatus('processing-practice');
      setYoloStatusMsg('Generating practice YOLO overlay locally…');

      const practiceFrames = await generateYoloOverlayFrames({
        videoUrl: userVideoUrl,
        color: '#FF0000',
        onProgress: (completed, total) => {
          setYoloPracFrames(completed);
          setYoloPracTotal(total);
        },
      });
      yoloPracFrameCacheRef.current = practiceFrames;
      await saveYoloOverlayFrames({
        sessionId: session.id,
        role: 'practice',
        framesDataUrl: practiceFrames,
      });

      setYoloStatus('ready');
      setYoloStatusMsg('');
      setYoloFrameVersion((v) => v + 1);
    } catch (err) {
      console.error('YOLO overlay generation error:', err);
      setYoloStatus('error');
      setYoloStatusMsg(err instanceof Error ? err.message : 'YOLO overlay generation failed.');
    }
  };

  const handleLoadedMetadata = () => {
    const nextDuration = Math.min(
      referenceVideoRef.current?.duration ?? Number.POSITIVE_INFINITY,
      userVideoRef.current?.duration ?? Number.POSITIVE_INFINITY,
    );

    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration);
    }
  };

  const ScoreCircle = ({ value, label }: { value: number; label: string }) => {
    const strokeDasharray = 2 * Math.PI * 36;
    const strokeDashoffset = strokeDasharray - (strokeDasharray * value) / 100;

    return (
      <div className="flex flex-col items-center">
        <div className="relative w-24 h-24">
          <svg className="transform -rotate-90 w-24 h-24">
            <circle
              cx="48"
              cy="48"
              r="36"
              stroke="#e5e7eb"
              strokeWidth="8"
              fill="none"
            />
            <circle
              cx="48"
              cy="48"
              r="36"
              stroke="url(#gradient)"
              strokeWidth="8"
              fill="none"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-gray-900">{value}</span>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium text-gray-600">{label}</p>
      </div>
    );
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <div className="mb-6 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Loading local session</h1>
          <p className="mt-2 max-w-md text-gray-600">Preparing your saved videos and analysis workspace.</p>
        </div>
      </div>
    );
  }

  if (pageError && !session?.analysis) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <div className="max-w-lg rounded-3xl border border-red-100 bg-red-50 px-8 py-8">
            <h1 className="text-2xl font-semibold text-gray-900">Session unavailable</h1>
            <p className="mt-3 text-gray-700">{pageError}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/upload"
                className="rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-all hover:bg-gray-800"
              >
                Start a new session
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full bg-gray-100 px-5 py-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200"
              >
                Open dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const summary = session?.analysis;
  const scores = summary?.scores;
  const worstSegment = summary?.segments.slice().sort((a, b) => a.score - b.score)[0];
  const referenceDisplayUrl = referenceVideoUrl;
  const practiceDisplayUrl = userVideoUrl;

  return (
    <div className="min-h-screen bg-white">
      <div className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-10">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold text-gray-900">
            TempoFlow
          </Link>
          <Link 
            href="/upload"
            className="px-4 py-2 bg-gray-900 text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-all"
          >
            New Session
          </Link>
        </div>
      </div>

      <div className="px-6 py-24 max-w-7xl mx-auto">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-32 h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-4">
            <span className="text-5xl font-bold text-white">{scores?.overall ?? '--'}</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {summary ? 'Your dance review is ready' : 'Analyzing your session'}
          </h1>
          <p className="text-gray-600">
            {summary
              ? `Strongest area: ${summary.strongestArea}. Main focus: ${summary.focusArea}.`
              : analysisStatus}
          </p>
        </div>

        <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Overlay method</h2>
              <p className="text-sm text-gray-600">
                Choose how the dancer&apos;s body is highlighted. YOLO runs entirely in your browser — no server needed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setOverlayMethod('pose-fill')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  overlayMethod === 'pose-fill'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Pose Fill
              </button>
              <button
                onClick={() => setOverlayMethod('yolo-seg')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  overlayMethod === 'yolo-seg'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                YOLO Seg ✦ local
              </button>
              <button
                onClick={() => setOverlayMethod('sam3-roboflow')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  overlayMethod === 'sam3-roboflow'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                }`}
              >
                SAM 3 (Roboflow)
              </button>
            </div>
          </div>

          {overlayMethod === 'yolo-seg' && (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">YOLO11s-seg — pre-generated local overlay</p>
                  <p className="mt-1 text-sm text-gray-700">
                    Runs entirely in your browser with the higher-quality YOLO11s segmentation model, generates overlay frames once, then replays them in sync with no live inference lag.
                  </p>
                </div>
                {yoloStatus === 'idle' || yoloStatus === 'error' ? (
                  <button
                    onClick={generateYoloOverlays}
                    disabled={!referenceVideoUrl || !userVideoUrl}
                    className="flex-shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Generate overlays
                  </button>
                ) : yoloStatus === 'ready' ? (
                  <button
                    onClick={generateYoloOverlays}
                    className="flex-shrink-0 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200"
                  >
                    Regenerate
                  </button>
                ) : null}
              </div>

              {(yoloStatus === 'processing-ref' || yoloStatus === 'processing-practice') && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-emerald-700">{yoloStatusMsg}</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>Reference</span>
                      <span>{yoloRefFrames}/{yoloRefTotal || '…'} frames</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${yoloRefTotal > 0 ? (yoloRefFrames / yoloRefTotal) * 100 : 5}%` }}
                      />
                    </div>
                    {yoloStatus === 'processing-practice' && (
                      <>
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>Practice</span>
                          <span>{yoloPracFrames}/{yoloPracTotal || '…'} frames</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${yoloPracTotal > 0 ? (yoloPracFrames / yoloPracTotal) * 100 : 5}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {yoloStatus === 'error' && (
                <p className="mt-2 text-xs text-red-600">{yoloStatusMsg}</p>
              )}

              {yoloStatus === 'ready' && (
                <p className="mt-2 text-xs text-emerald-600">
                  ✓ {yoloRefFrameCacheRef.current.length} reference frames · {yoloPracFrameCacheRef.current.length} practice frames cached
                </p>
              )}
            </div>
          )}

          {overlayMethod === 'sam3-roboflow' && (
            <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-purple-700">SAM 3 (Roboflow) — pre-rendered video overlay</p>
                  <p className="mt-1 text-sm text-gray-700">
                    Sends both videos to Roboflow&apos;s GPU (SAM 3, <code className="text-xs">webrtc-gpu-large</code>), receives rendered frames, then plays them in sync.
                    Uses API credits. Requires <code className="text-xs">ROBOFLOW_WORKSPACE_NAME</code> + <code className="text-xs">ROBOFLOW_WORKFLOW_ID</code> in{' '}
                    <code className="text-xs">.env.local</code>.
                  </p>
                </div>

                {sam3Status === 'idle' || sam3Status === 'error' ? (
                  <button
                    onClick={generateSam3Overlays}
                    disabled={!referenceVideoUrl || !userVideoUrl}
                    className="flex-shrink-0 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-purple-700 disabled:opacity-50"
                  >
                    Generate overlays
                  </button>
                ) : sam3Status === 'ready' ? (
                  <button
                    onClick={generateSam3Overlays}
                    className="flex-shrink-0 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200"
                  >
                    Regenerate
                  </button>
                ) : null}
              </div>

              {/* Progress while generating */}
              {(sam3Status === 'processing-ref' || sam3Status === 'processing-practice') && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-purple-600">{sam3StatusMsg}</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>Reference</span>
                      <span>{sam3RefProgress < 100 ? `Upload ${sam3RefProgress}%` : `${sam3RefFrames} frames`}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-purple-100">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all"
                        style={{ width: `${sam3Status === 'processing-ref' ? Math.max(5, sam3RefProgress) : 100}%` }}
                      />
                    </div>
                    {sam3Status === 'processing-practice' && (
                      <>
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>Practice</span>
                          <span>{sam3PracProgress < 100 ? `Upload ${sam3PracProgress}%` : `${sam3PracFrames} frames`}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-purple-100">
                          <div
                            className="h-full rounded-full bg-purple-500 transition-all"
                            style={{ width: `${Math.max(5, sam3PracProgress)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {sam3Status === 'error' && (
                <p className="mt-2 text-xs text-red-600">{sam3StatusMsg}</p>
              )}

              {sam3Status === 'ready' && (
                <p className="mt-2 text-xs text-emerald-600">
                  ✓ {refFrameCacheRef.current.length} reference frames · {pracFrameCacheRef.current.length} practice frames cached
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500">
            YOLO Seg runs{' '}
            <a href="https://docs.ultralytics.com/models/yolo11/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              YOLO11s-seg
            </a>{' '}
            locally via{' '}
            <a href="https://onnxruntime.ai/docs/get-started/with-javascript/web.html" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              ONNX Runtime Web
            </a>
            . SAM 3 uses{' '}
            <a href="https://inference.roboflow.com/foundation/sam3/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Roboflow serverless
            </a>
            .
          </p>
        </div>

        {!summary && (
          <div className="mb-10 rounded-3xl border border-purple-100 bg-purple-50 px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-purple-600">Local analysis in progress</p>
                <p className="mt-1 text-gray-700">{analysisStatus}</p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{analysisProgress}%</p>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-purple-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                style={{ width: `${analysisProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          <ScoreCircle value={scores?.timing ?? 0} label="Timing" />
          <ScoreCircle value={scores?.positioning ?? 0} label="Positioning" />
          <ScoreCircle value={scores?.smoothness ?? 0} label="Smoothness" />
          <ScoreCircle value={scores?.energy ?? 0} label="Energy" />
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Movement Comparison</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Reference</p>
              <div className="relative aspect-video bg-gray-900 rounded-3xl overflow-hidden group">
                {overlayMethod === 'yolo-seg' && yoloStatus === 'ready' && (
                  <div className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                    YOLO overlay
                  </div>
                )}
                {overlayMethod === 'sam3-roboflow' && sam3Status === 'ready' && (
                  <div className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                    SAM 3 overlay
                  </div>
                )}
                <video
                    ref={referenceVideoRef}
                  src={referenceDisplayUrl ?? undefined}
                    className="w-full h-full object-cover"
                    loop
                    muted
                    playsInline
                    crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  onError={(error) => console.error('Reference video error:', error)}
                />
                {overlayMethod === 'pose-fill' && (
                  <PoseOverlay videoRef={referenceVideoRef} color="#00FF00" method="pose-fill" />
                )}
                {overlayMethod === 'yolo-seg' && yoloStatus === 'ready' && yoloFrameVersion > 0 && (
                  <RoboflowVideoOverlay
                    frames={yoloRefFrameCacheRef.current}
                    videoRef={referenceVideoRef}
                  />
                )}
                {overlayMethod === 'sam3-roboflow' && sam3Status === 'ready' && sam3FrameVersion > 0 && (
                  <RoboflowVideoOverlay
                    frames={refFrameCacheRef.current}
                    videoRef={referenceVideoRef}
                  />
                )}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Your Practice</p>
              <div className="relative aspect-video bg-gray-900 rounded-3xl overflow-hidden group">
                {overlayMethod === 'yolo-seg' && yoloStatus === 'ready' && (
                  <div className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                    YOLO overlay
                  </div>
                )}
                {overlayMethod === 'sam3-roboflow' && sam3Status === 'ready' && (
                  <div className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                    SAM 3 overlay
                  </div>
                )}
                <video
                    ref={userVideoRef}
                  src={practiceDisplayUrl ?? undefined}
                    className="w-full h-full object-cover grayscale opacity-80"
                    loop
                    muted
                    playsInline
                    crossOrigin="anonymous"
                  onLoadedMetadata={handleLoadedMetadata}
                  onError={(error) => console.error('User video error:', error)}
                />
                {overlayMethod === 'pose-fill' && (
                  <PoseOverlay videoRef={userVideoRef} color="#FF0000" method="pose-fill" />
                )}
                {overlayMethod === 'yolo-seg' && yoloStatus === 'ready' && yoloFrameVersion > 0 && (
                  <RoboflowVideoOverlay
                    frames={yoloPracFrameCacheRef.current}
                    videoRef={userVideoRef}
                  />
                )}
                {overlayMethod === 'sam3-roboflow' && sam3Status === 'ready' && sam3FrameVersion > 0 && (
                  <RoboflowVideoOverlay
                    frames={pracFrameCacheRef.current}
                    videoRef={userVideoRef}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm text-gray-600 w-20 text-right">
                {Math.floor(currentTime)}s / {Math.floor(duration)}s
              </span>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={togglePlayPause}
                className="w-14 h-14 flex items-center justify-center bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-all active:scale-95 shadow-lg"
              >
                {isPlaying ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              {worstSegment && (
                <button
                  onClick={() => jumpToTime(worstSegment.startSec)}
                  className="rounded-full bg-purple-50 px-4 py-3 text-sm font-medium text-purple-700 transition-all hover:bg-purple-100"
                >
                  Jump to hardest section
                </button>
              )}
            </div>
          </div>
        </div>

        {summary?.segments && summary.segments.length > 0 && (
          <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-8">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Practice targets</h3>
                <p className="text-sm text-gray-600">Replay the weakest sections first for faster iteration.</p>
              </div>
              <Link
                href="/dashboard"
                className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200"
              >
                View all sessions
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {summary.segments.map((segment) => (
                <button
                  key={segment.id}
                  onClick={() => jumpToTime(segment.startSec)}
                  className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-all hover:border-purple-200 hover:bg-purple-50"
                >
                  <p className="text-sm font-semibold text-gray-900">{segment.label}</p>
                  <p className="mt-1 text-sm text-gray-600">
                    {segment.startSec.toFixed(1)}s-{segment.endSec.toFixed(1)}s
                  </p>
                  <p className="mt-2 text-sm text-gray-700">Focus area: {segment.focusArea}</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{segment.score}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-purple-50 rounded-3xl p-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Key insights</h3>
          <ul className="space-y-3">
            {summary?.insights.map((insight) => (
              <li key={insight.id} className="flex items-start gap-3">
                <span className="mt-1 text-sm font-semibold text-purple-600">
                  {insight.tone === 'positive' ? 'GOOD' : insight.tone === 'focus' ? 'FOCUS' : 'TIP'}
                </span>
                <div>
                  <p className="font-medium text-gray-900">{insight.title}</p>
                  <p className="text-gray-700">{insight.body}</p>
                </div>
            </li>
            ))}
            {pageError && (
              <li className="text-sm text-red-700">{pageError}</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white">
          <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
            <div className="mb-6 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-purple-600" />
            <h1 className="text-2xl font-semibold text-gray-900">Loading local session</h1>
            <p className="mt-2 max-w-md text-gray-600">Preparing your saved videos and analysis workspace.</p>
          </div>
        </div>
      }
    >
      <AnalysisPageContent />
    </Suspense>
  );
}
