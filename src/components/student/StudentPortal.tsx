import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LogIn,
  ShieldAlert,
  Users,
  WifiOff,
} from 'lucide-react';
import type { StudentSessionView, Team, ViolationType } from '../../types.ts';
import { api, loadStudentStorage, saveStudentStorage } from '../../lib/api.ts';
import { subscribeStudentSession, type ConnectionState } from '../../lib/sse.ts';
import { useI18n } from '../../lib/i18n.ts';
import { LanguageAndThemeControls } from '../shared/TopControls.tsx';
import { useToast } from '../shared/Toast.tsx';
import { QuizRunner } from './QuizRunner.tsx';
import { VoteView } from './VoteView.tsx';
import { ResultsView } from './ResultsView.tsx';

interface StudentPortalProps {
  initialRoom?: string;
  onGoTeacherLogin: () => void;
}

type JoinStep = 'room' | 'identity' | 'proctoring' | 'session';

export const StudentPortal: React.FC<StudentPortalProps> = ({
  initialRoom = '',
  onGoTeacherLogin,
}) => {
  const { t } = useI18n();
  const toast = useToast();

  const [step, setStep] = useState<JoinStep>('room');
  const [roomInput, setRoomInput] = useState(initialRoom.toUpperCase());
  const [roomInfo, setRoomInfo] = useState<{
    name: string;
    hasActiveSession: boolean;
    title?: string;
    kind?: string;
    requireNames?: boolean;
    requireStudentCode?: boolean;
    proctoring?: StudentSessionView['settings']['proctoring'];
    teams?: Team[];
  } | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [studentToken, setStudentToken] = useState<string | null>(null);
  const [view, setView] = useState<StudentSessionView | null>(null);
  const [connState, setConnState] = useState<ConnectionState>('connected');
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [proctoringAccepted, setProctoringAccepted] = useState(false);
  const flushingRef = useRef(false);

  // Restore saved student session from localStorage on refresh
  useEffect(() => {
    const saved = loadStudentStorage();
    if (!saved) return;
    setLoading(true);
    api
      .studentState(saved.token)
      .then(({ view: v }) => {
        setStudentToken(saved.token);
        setView(v);
        setPendingCount(saved.pendingAnswers.length);
        setProctoringAccepted(Boolean(saved.proctoringAccepted) || !v.settings.proctoring?.enabled);
        setStep('session');
      })
      .catch(() => {
        saveStudentStorage(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-lookup if initialRoom passed via /join?room=...
  useEffect(() => {
    if (initialRoom && step === 'room' && !studentToken) {
      setRoomInput(initialRoom.toUpperCase());
      void handleLookupRoom(initialRoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoom]);

  // Subscribe to SSE + polling fallback while in session
  useEffect(() => {
    if (step !== 'session' || !studentToken || !view?.sessionId) return;
    const unsub = subscribeStudentSession({
      sessionId: view.sessionId,
      studentToken,
      onView: (nextView) => {
        setView(nextView);
      },
      onKicked: (reason) => {
        setKickedReason(reason);
        saveStudentStorage(null);
      },
      onConnectionChange: (st) => {
        setConnState(st);
        if (st === 'connected') {
          void flushPendingAnswers();
        }
      },
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, studentToken, view?.sessionId]);

  // Flush offline queued answers when browser comes online
  const flushPendingAnswers = async () => {
    if (flushingRef.current) return;
    const saved = loadStudentStorage();
    if (!saved || saved.pendingAnswers.length === 0) return;
    flushingRef.current = true;
    try {
      const remaining = [...saved.pendingAnswers];
      while (remaining.length > 0) {
        const next = remaining[0];
        const res = await api.studentSubmitAnswer(saved.token, next);
        setView(res.view);
        remaining.shift();
        saveStudentStorage({ ...saved, pendingAnswers: remaining });
        setPendingCount(remaining.length);
      }
      toast.success('Офлайн сақталған жауаптар сәтті жіберілді');
    } catch {
      // Still offline; retry next reconnect
    } finally {
      flushingRef.current = false;
    }
  };

  useEffect(() => {
    const onOnline = () => {
      void flushPendingAnswers();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookupRoom = async (nameOverride?: string) => {
    const code = (nameOverride ?? roomInput).trim().toUpperCase();
    if (!code) {
      setError('Бөлме атауын енгізіңіз.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { room } = await api.lookupRoom(code);
      if (!room.hasActiveSession) {
        setError('Бөлме табылды, бірақ мұғалім әзірге тапсырма бастаған жоқ. Сәл күтіп қайталаңыз.');
        return;
      }
      setRoomInfo(room);
      if (room.teams && room.teams.length > 0) {
        setSelectedTeamId(room.teams[0].id);
      }
      setStep('identity');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomInfo) return;
    if (roomInfo.requireNames !== false && !displayName.trim()) {
      setError('Аты-жөніңізді енгізіңіз.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.joinRoom({
        roomName: roomInfo.name,
        displayName: displayName.trim(),
        studentCode: studentCode.trim() || undefined,
        teamId: selectedTeamId || undefined,
      });
      const needsProctoringConsent = Boolean(res.view.settings.proctoring?.enabled);
      setStudentToken(res.token);
      setView(res.view);
      setProctoringAccepted(!needsProctoringConsent);
      saveStudentStorage({
        token: res.token,
        sessionId: res.view.sessionId,
        roomName: res.view.roomName,
        displayName: res.view.student.displayName,
        proctoringAccepted: !needsProctoringConsent,
        pendingAnswers: [],
      });
      setStep(needsProctoringConsent ? 'proctoring' : 'session');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptProctoring = async () => {
    if (view?.settings.proctoring?.requireFullscreen) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        // Some mobile browsers block fullscreen; still allow entry
      }
    }
    setProctoringAccepted(true);
    const saved = loadStudentStorage();
    if (saved) saveStudentStorage({ ...saved, proctoringAccepted: true });
    setStep('session');
  };

  const handleSubmitAnswer = async (
    questionId: string,
    value: string[],
    timeSpentMs: number
  ) => {
    if (!studentToken) return;
    try {
      const res = await api.studentSubmitAnswer(studentToken, {
        questionId,
        value,
        timeSpentMs,
      });
      setView(res.view);
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr.status === 0 || !navigator.onLine) {
        // Queue locally so answers are never lost on disconnect
        const saved = loadStudentStorage();
        if (saved) {
          const nextQueue = [
            ...saved.pendingAnswers.filter((p) => p.questionId !== questionId),
            { questionId, value, timeSpentMs },
          ];
          saveStudentStorage({ ...saved, pendingAnswers: nextQueue });
          setPendingCount(nextQueue.length);
        }
        toast.info(t('offline_queued'));
      } else {
        toast.error(apiErr.message || 'Жауапты жіберу сәтсіз болды.');
      }
    }
  };

  const handleReportViolation = async (type: ViolationType, details?: string) => {
    if (!studentToken) return;
    try {
      const res = await api.studentViolation(studentToken, type, details);
      setView(res.view);
      if (res.autoClosed) {
        toast.error('Прокторинг ескерту лимиті толды — сессия автоматты аяқталды.');
      }
    } catch {}
  };

  const handleLeaveSession = () => {
    saveStudentStorage(null);
    setStudentToken(null);
    setView(null);
    setKickedReason(null);
    setRoomInfo(null);
    setStep('room');
  };

  // Kicked Screen
  if (kickedReason) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
        <header className="flex items-center justify-between px-4 sm:px-6 h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
            QuizKZ Live
          </span>
          <LanguageAndThemeControls compact />
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {t('kicked_title')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{kickedReason}</p>
            <button
              type="button"
              onClick={handleLeaveSession}
              className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Басты бетке оралу
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Active Session Views
  if (step === 'session' && view && studentToken) {
    const isFinished =
      view.status === 'ended' ||
      Boolean(view.student.finishedAt);

    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs no-print">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400 shrink-0">
              {view.roomName}
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
              {view.student.displayName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {connState !== 'connected' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <WifiOff className="w-3.5 h-3.5" />
                {t('reconnecting')}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                Кезекте: {pendingCount}
              </span>
            )}
            <LanguageAndThemeControls compact />
          </div>
        </header>

        <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 flex flex-col">
          {view.status === 'lobby' ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
                <div className="space-y-1.5">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {view.title}
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {t('waiting_teacher')}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span>
                    {t('connected_students')}:{' '}
                    <strong className="font-mono tabular-nums">{view.lobbyCount}</strong>
                  </span>
                </div>
                {view.kind === 'space_race' && view.student.teamId && view.teams && (
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Командаңыз:{' '}
                    <span
                      className="font-bold"
                      style={{
                        color: view.teams.find((tm) => tm.id === view.student.teamId)?.color,
                      }}
                    >
                      {view.teams.find((tm) => tm.id === view.student.teamId)?.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : view.status === 'paused' ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-2xl p-8 text-center space-y-3">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Сессия уақытша тоқтатылды (Үзіліс)
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Мұғалім сабақты жалғастырған кезде экран автоматты ашылады.
                </p>
              </div>
            </div>
          ) : view.kind === 'vote' && view.status !== 'ended' ? (
            <VoteView
              view={view}
              studentToken={studentToken}
              onViewUpdate={setView}
            />
          ) : isFinished ? (
            <ResultsView
              view={view}
              studentToken={studentToken}
              onViewUpdate={setView}
              onExit={handleLeaveSession}
            />
          ) : (
            <QuizRunner
              view={view}
              proctoringActive={proctoringAccepted && Boolean(view.settings.proctoring?.enabled)}
              onSubmitAnswer={handleSubmitAnswer}
              onFinish={async () => {
                try {
                  const res = await api.studentFinish(studentToken);
                  setView(res.view);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
              onViolation={handleReportViolation}
            />
          )}
        </main>
      </div>
    );
  }

  // Entry / Identity / Proctoring Consent Views
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Top Bar Contract: Brand | Language & Theme | Teacher Login */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="font-display font-extrabold text-xl tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            QuizKZ <span className="text-emerald-600 dark:text-emerald-400">Live</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <LanguageAndThemeControls compact />
            <button
              type="button"
              onClick={onGoTeacherLogin}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">{t('teacher_login')}</span>
              <span className="sm:hidden">Мұғалім</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          {step === 'room' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
              <div className="space-y-1.5 text-center">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {t('join_title')}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {t('join_subtitle')}
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLookupRoom();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="room-name-input"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t('room_name_label')}
                  </label>
                  <input
                    id="room-name-input"
                    type="text"
                    autoFocus
                    autoComplete="off"
                    value={roomInput}
                    onChange={(e) => {
                      setRoomInput(e.target.value.toUpperCase());
                      setError('');
                    }}
                    placeholder={t('room_name_placeholder')}
                    className="w-full h-14 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-center font-mono text-2xl font-bold tracking-widest uppercase text-slate-900 dark:text-slate-100 placeholder:text-slate-400 placeholder:text-base placeholder:tracking-normal placeholder:font-sans focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-13 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold text-base inline-flex items-center justify-center gap-2 transition-colors"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>{t('join_btn')}</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                Телефон · Планшет · Ноутбук · Орнатусыз тікелей браузерден
              </div>
            </div>
          )}

          {step === 'identity' && roomInfo && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
              <div className="space-y-1">
                <div className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  Бөлме: {roomInfo.name}
                </div>
                <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                  {roomInfo.title || 'Тапсырмаға қосылу'}
                </h1>
              </div>

              <form onSubmit={handleJoinSubmit} className="space-y-4">
                {roomInfo.requireNames !== false && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="student-name-input"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t('student_name_label')} *
                    </label>
                    <input
                      id="student-name-input"
                      type="text"
                      required
                      autoFocus
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        setError('');
                      }}
                      placeholder={t('student_name_placeholder')}
                      className="w-full h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="student-code-input"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t('student_code_label')}
                    {roomInfo.requireStudentCode ? ' *' : ''}
                  </label>
                  <input
                    id="student-code-input"
                    type="text"
                    required={Boolean(roomInfo.requireStudentCode)}
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    placeholder={t('student_code_placeholder')}
                    className="w-full h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  />
                </div>

                {roomInfo.teams && roomInfo.teams.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('choose_team')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {roomInfo.teams.map((tm) => (
                        <button
                          key={tm.id}
                          type="button"
                          onClick={() => setSelectedTeamId(tm.id)}
                          className={`min-h-[48px] px-3 py-2 rounded-xl border text-sm font-semibold flex items-center gap-2 transition-colors ${
                            selectedTeamId === tm.id
                              ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-slate-900 dark:text-slate-100'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0"
                            style={{ backgroundColor: tm.color }}
                          />
                          <span className="truncate">{tm.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('room');
                      setError('');
                    }}
                    className="h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('back_btn')}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold inline-flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('continue_btn')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 'proctoring' && view && (
            <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-8 h-8 text-amber-600 shrink-0" />
                <div>
                  <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                    Емтихан режимі (Прокторинг)
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Бастамас бұрын төмендегі ережелермен танысыңыз
                  </p>
                </div>
              </div>

              <ul className="space-y-2.5 text-sm text-slate-700 dark:text-slate-300">
                {view.settings.proctoring?.requireFullscreen && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Толық экран режимінде орындау талап етіледі; шықсаңыз ескерту жазылады.</span>
                  </li>
                )}
                {view.settings.proctoring?.detectTabSwitch && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Басқа қойындыға немесе терезеге ауысу автоматты түрде тіркеледі.</span>
                  </li>
                )}
                {view.settings.proctoring?.blockCopyPaste && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Мәтінді көшіру, қою және оң жақ шерту өшірілген.</span>
                  </li>
                )}
                {view.settings.proctoring && view.settings.proctoring.maxViolations > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Рұқсат етілген ескерту лимиті:{' '}
                      <strong>{view.settings.proctoring.maxViolations}</strong>.{' '}
                      {view.settings.proctoring.actionOnLimit === 'auto_submit'
                        ? 'Лимит толғанда жұмыс автоматты түрде жабылады.'
                        : 'Барлық ескертулер мұғалім журналына жазылады.'}
                    </span>
                  </li>
                )}
              </ul>

              <button
                type="button"
                onClick={handleAcceptProctoring}
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Түсіндім, тапсырманы бастау
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
