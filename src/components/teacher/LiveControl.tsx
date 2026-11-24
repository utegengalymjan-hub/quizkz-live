import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  ShieldAlert,
  Square,
  Trophy,
  Unlock,
  UserX,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type { Answer, Question, QuestionType, Session, Student } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { subscribeTeacherSession, type ConnectionState } from '../../lib/sse.ts';
import { formatCountdown, formatDurationMs } from '../../lib/utils.ts';
import { useI18n } from '../../lib/i18n.ts';
import { HorizontalBarChart, SpaceRaceTrack } from '../shared/Charts.tsx';
import { ConfirmDialog, Modal } from '../shared/Modal.tsx';
import { RichText } from '../shared/RichText.tsx';
import { RoomQrModal } from '../shared/TopControls.tsx';
import { useToast } from '../shared/Toast.tsx';

export const LiveControl: React.FC<{
  sessionId: string;
  onExit: () => void;
  onOpenReport: (sessionId: string) => void;
  onReplaySession: (newSessionId: string) => void;
}> = ({ sessionId, onExit, onOpenReport, onReplaySession }) => {
  const { t } = useI18n();
  const toast = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [connState, setConnState] = useState<ConnectionState>('connected');
  const [viewTab, setViewTab] = useState<'class' | 'student' | 'question'>('class');
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [projectorMode, setProjectorMode] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [roomLocked, setRoomLocked] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Manual grading modal
  const [gradeTarget, setGradeTarget] = useState<{
    student: Student;
    question: Question;
    answer: Answer;
  } | null>(null);
  const [gradePoints, setGradePoints] = useState(1);
  const [gradeCorrect, setGradeCorrect] = useState(true);
  const [gradeAcceptForAll, setGradeAcceptForAll] = useState(false);

  // Violation details modal
  const [violationStudent, setViolationStudent] = useState<Student | null>(null);

  // Quick Question inline builder
  const [qqOpen, setQqOpen] = useState(false);
  const [qqType, setQqType] = useState<QuestionType>('multiple_choice');
  const [qqText, setQqText] = useState('');

  // Vote new round modal
  const [newVotePrompt, setNewVotePrompt] = useState('');

  useEffect(() => {
    const unsub = subscribeTeacherSession({
      sessionId,
      onSession: (s) => {
        setSession(s);
        if (s.settings.pacing === 'teacher_paced' || s.kind === 'quick_question') {
          setSelectedQuestionIdx(s.currentQuestionIndex);
        }
      },
      onViolation: (info) => {
        toast.info(
          `Прокторинг: ${info.displayName} (${info.type}) — барлығы ${info.totalViolations}`
        );
      },
      onConnectionChange: setConnState,
    });
    return unsub;
  }, [sessionId, toast]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  void nowTick;

  const activeStudents = useMemo(
    () => (session ? session.students.filter((s) => !s.kicked) : []),
    [session]
  );

  const questions = useMemo(
    () =>
      session
        ? [...session.quizSnapshot.questions].sort((a, b) => a.order - b.order)
        : [],
    [session]
  );

  const answersMap = useMemo(() => {
    const m = new Map<string, Answer>();
    if (!session) return m;
    for (const a of session.answers) {
      m.set(`${a.studentId}:${a.questionId}`, a);
    }
    return m;
  }, [session]);

  const toggleProjector = async () => {
    const next = !projectorMode;
    setProjectorMode(next);
    try {
      if (next && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    } catch {}
  };

  const openGradeModal = (student: Student, question: Question, answer: Answer) => {
    setGradeTarget({ student, question, answer });
    const pts = answer.manualGrade ? answer.manualGrade.points : answer.points;
    const isCorr = answer.manualGrade
      ? answer.manualGrade.isCorrect
      : answer.isCorrect === true;
    setGradePoints(pts || question.points || 1);
    setGradeCorrect(isCorr);
    setGradeAcceptForAll(false);
  };

  const submitManualGrade = async () => {
    if (!session || !gradeTarget) return;
    try {
      const { session: updated } = await api.gradeAnswer(session.id, {
        answerId: gradeTarget.answer.id,
        points: gradePoints,
        isCorrect: gradeCorrect,
        acceptForAll: gradeAcceptForAll,
      });
      setSession(updated);
      setGradeTarget(null);
      toast.success('Баға сақталды және есеп қайта есептелді');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!session) {
    return <div className="py-20 text-center text-slate-500">{t('loading')}</div>;
  }

  const currentQuestion = questions[selectedQuestionIdx] || questions[0];
  const overallTimer = formatCountdown(session.timerEndsAt);
  const questionTimer = formatCountdown(session.questionTimerEndsAt);
  const isTeacherPaced =
    session.settings.pacing === 'teacher_paced' || session.kind === 'quick_question';

  const getQuestionDistribution = (q: Question) => {
    const dist = new Map<string, number>();
    if (q.options) {
      for (const o of q.options) dist.set(o.id, 0);
    }
    for (const st of activeStudents) {
      const ans = answersMap.get(`${st.id}:${q.id}`);
      if (!ans) continue;
      for (const v of ans.value) {
        const key = q.type === 'short_answer' ? v.trim() || '(бос)' : v;
        dist.set(key, (dist.get(key) || 0) + 1);
      }
    }
    if (q.options) {
      return q.options.map((o) => ({
        id: o.id,
        label:
          q.type === 'true_false'
            ? o.text
            : `${o.id.toUpperCase()}) ${o.text}`,
        count: dist.get(o.id) || 0,
        highlight: q.correct.includes(o.id),
      }));
    }
    return [...dist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([text, count], idx) => ({
        id: `${idx}-${text}`,
        label: text,
        count,
        highlight: q.correct.some((c) => c.toLowerCase() === text.toLowerCase()),
      }));
  };

  // =========================================================================
  // PROJECTOR / PRESENTER VIEW (ANONYMOUS, HIGH CONTRAST, FULLSCREEN)
  // =========================================================================
  if (projectorMode) {
    const currentVote = session.votes?.[session.votes.length - 1];
    const winningTeam =
      session.teams && session.teams.length > 0
        ? [...session.teams].sort((a, b) => b.score - a.score)[0]
        : null;

    return (
      <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col p-6 sm:p-10 overflow-y-auto">
        <div className="flex items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <span className="font-mono text-2xl sm:text-3xl font-bold text-emerald-400">
              {session.roomName}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-lg sm:text-xl font-semibold text-slate-200 truncate">
              {session.title}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {(questionTimer || overallTimer) && (
              <span className="font-mono text-3xl font-bold text-amber-400 tabular-nums">
                {questionTimer || overallTimer}
              </span>
            )}
            <span className="font-mono text-lg text-slate-300 tabular-nums">
              Оқушылар: {activeStudents.length}
            </span>
            <button
              type="button"
              onClick={() => void toggleProjector()}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold inline-flex items-center gap-2"
            >
              <Minimize2 className="w-4 h-4" />
              Шығу
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-5xl w-full mx-auto py-8 space-y-8">
          {session.kind === 'space_race' && session.teams ? (
            <>
              {session.status === 'ended' && winningTeam && (
                <div className="text-center space-y-2 pb-4">
                  <Trophy className="w-16 h-16 text-amber-400 mx-auto" />
                  <h1 className="font-display text-4xl font-extrabold">
                    Жеңімпаз: <span style={{ color: winningTeam.color }}>{winningTeam.name}</span>
                  </h1>
                </div>
              )}
              <SpaceRaceTrack
                teams={session.teams}
                icon={session.settings.spaceRaceIcon || 'rocket'}
                projector
              />
            </>
          ) : session.kind === 'vote' && currentVote ? (
            <div className="space-y-6">
              <h1 className="font-display text-3xl sm:text-4xl font-bold leading-snug">
                <RichText text={currentVote.prompt} />
              </h1>
              <div className="text-lg text-slate-400">
                Жауаптар: {currentVote.submissions.length} · Дауыстар: {currentVote.ballots.length}
              </div>
              {currentVote.phase !== 'collecting' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                  <HorizontalBarChart
                    large
                    items={[...currentVote.submissions]
                      .map((sub) => ({
                        id: sub.id,
                        label: sub.text,
                        count: currentVote.ballots.filter((b) => b.submissionId === sub.id).length,
                      }))
                      .sort((a, b) => b.count - a.count)
                      .map((it, i) => ({ ...it, highlight: i === 0 }))}
                  />
                </div>
              )}
            </div>
          ) : currentQuestion ? (
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="text-sm font-mono text-emerald-400">
                  Сұрақ {selectedQuestionIdx + 1} / {questions.length} (анонимді режим)
                </div>
                <div className="text-3xl sm:text-4xl font-bold leading-snug">
                  <RichText text={currentQuestion.text} />
                </div>
                {currentQuestion.imageUrl && (
                  <img
                    src={currentQuestion.imageUrl}
                    alt="Сұрақ"
                    className="max-h-72 rounded-xl bg-white p-2"
                  />
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <HorizontalBarChart large items={getQuestionDistribution(currentQuestion)} />
              </div>

              {isTeacherPaced && (
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    disabled={session.currentQuestionIndex === 0}
                    onClick={() => void api.prevQuestion(session.id)}
                    className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 font-semibold inline-flex items-center gap-2"
                  >
                    <ChevronLeft className="w-5 h-5" /> Алдыңғы
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void api.revealAnswer(session.id, !session.settings.revealCorrectAnswer)
                    }
                    className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
                  >
                    {session.settings.revealCorrectAnswer
                      ? 'Дұрыс жауапты жасыру'
                      : 'Дұрыс жауапты көрсету'}
                  </button>
                  <button
                    type="button"
                    disabled={session.currentQuestionIndex >= questions.length - 1}
                    onClick={() => void api.nextQuestion(session.id)}
                    className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 font-semibold inline-flex items-center gap-2"
                  >
                    Келесі <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // =========================================================================
  // MAIN TEACHER LIVE CONTROL DASHBOARD
  // =========================================================================
  const totalPointsPossible = questions.reduce((acc, q) => acc + (q.points ?? 1), 0);
  const currentVote = session.votes?.[session.votes.length - 1];
  const winningTeam =
    session.teams && session.teams.length > 0
      ? [...session.teams].sort((a, b) => b.score - a.score)[0]
      : null;

  return (
    <div className="space-y-6">
      {/* Top Control Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onExit}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {session.roomName}
              </span>
              <span>·</span>
              <span>{session.kind}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                {connState === 'connected' ? (
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                )}
                {session.status}
              </span>
              {(questionTimer || overallTimer) && (
                <>
                  <span>·</span>
                  <span className="font-mono font-semibold text-amber-600 tabular-nums inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {questionTimer || overallTimer}
                  </span>
                </>
              )}
            </div>
            <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
              {session.title}
            </h1>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <QrCode className="w-4 h-4" />
            QR
          </button>
          <button
            type="button"
            onClick={() => void toggleProjector()}
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Maximize2 className="w-4 h-4" />
            {t('projector_mode')}
          </button>
          <button
            type="button"
            onClick={async () => {
              const next = !roomLocked;
              await api.lockSessionRoom(session.id, next);
              setRoomLocked(next);
              toast.success(next ? 'Бөлме құлыпталды' : 'Бөлме ашылды');
            }}
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {roomLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {roomLocked ? 'Ашу' : 'Құлыптау'}
          </button>

          {session.status === 'lobby' && (
            <button
              type="button"
              onClick={async () => {
                const { session: s } = await api.startSession(session.id);
                setSession(s);
              }}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Play className="w-4 h-4" />
              {t('start')}
            </button>
          )}

          {session.status === 'running' && (
            <button
              type="button"
              onClick={async () => {
                const { session: s } = await api.pauseSession(session.id);
                setSession(s);
              }}
              className="h-9 px-3 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Pause className="w-4 h-4" />
              {t('pause')}
            </button>
          )}

          {session.status === 'paused' && (
            <button
              type="button"
              onClick={async () => {
                const { session: s } = await api.resumeSession(session.id);
                setSession(s);
              }}
              className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Play className="w-4 h-4" />
              {t('resume')}
            </button>
          )}

          {session.status !== 'ended' ? (
            <button
              type="button"
              onClick={() => setEndConfirmOpen(true)}
              className="h-9 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              {t('end_session')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenReport(session.id)}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Толық есепті ашу
            </button>
          )}
        </div>
      </div>

      {/* Timer + Teacher-Paced Navigation Toolbar */}
      {session.status !== 'ended' && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-500">Таймер:</span>
            <button
              type="button"
              onClick={() => void api.updateTimer(session.id, 'add_seconds', 30)}
              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono"
            >
              +30с
            </button>
            <button
              type="button"
              onClick={() => void api.updateTimer(session.id, 'add_seconds', 60)}
              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono"
            >
              +1м
            </button>
            {(session.timerEndsAt || session.questionTimerEndsAt) && (
              <button
                type="button"
                onClick={() => void api.updateTimer(session.id, 'clear')}
                className="px-2.5 py-1 rounded-md border border-red-200 dark:border-red-900 text-red-600"
              >
                Таймерді өшіру
              </button>
            )}
          </div>

          {isTeacherPaced && questions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={session.currentQuestionIndex === 0}
                onClick={() => void api.prevQuestion(session.id)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 font-semibold inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Алдыңғы
              </button>
              <span className="font-mono font-bold tabular-nums px-2">
                {session.currentQuestionIndex + 1} / {questions.length}
              </span>
              <button
                type="button"
                disabled={session.currentQuestionIndex >= questions.length - 1}
                onClick={() => void api.nextQuestion(session.id)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40 font-semibold inline-flex items-center gap-1"
              >
                Келесі <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  void api.revealAnswer(session.id, !session.settings.revealCorrectAnswer)
                }
                className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 ${
                  session.settings.revealCorrectAnswer
                    ? 'bg-emerald-600 text-white'
                    : 'border border-emerald-600 text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {session.settings.revealCorrectAnswer ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                {session.settings.revealCorrectAnswer ? 'Жауапты жасыру' : 'Дұрыс жауапты көрсету'}
              </button>
            </div>
          )}

          {session.kind === 'quick_question' && (
            <button
              type="button"
              onClick={() => setQqOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Келесі жылдам сұрақ
            </button>
          )}
        </div>
      )}

      {/* LOBBY VIEW */}
      {session.status === 'lobby' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Күту бөлмесі (Лобби) — {activeStudents.length} оқушы қосылды
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Оқушылар бөлме атауы <strong className="font-mono">{session.roomName}</strong> арқылы қосылады.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const { session: s } = await api.startSession(session.id);
                setSession(s);
              }}
              className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Сабақты бастау
            </button>
          </div>

          {activeStudents.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Оқушылар қосылуын күтуде… QR-кодты проектордан көрсетіңіз.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {activeStudents.map((st) => (
                <div
                  key={st.id}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                      {st.displayName}
                    </div>
                    {st.studentCode && (
                      <div className="text-xs font-mono text-slate-400">{st.studentCode}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {session.kind === 'space_race' && session.teams && (
                      <select
                        value={st.teamId || ''}
                        onChange={(e) =>
                          void api.assignTeam(session.id, st.id, e.target.value)
                        }
                        className="h-7 px-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        {session.teams.map((tm) => (
                          <option key={tm.id} value={tm.id}>
                            {tm.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => void api.kickStudent(session.id, st.id, false)}
                      title="Шығару"
                      className="p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SPACE RACE TRACK */}
      {session.kind === 'space_race' && session.teams && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
          {session.status === 'ended' && winningTeam && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Trophy className="w-7 h-7 text-amber-500" />
                <div>
                  <div className="text-xs text-slate-500">Жеңімпаз команда</div>
                  <div className="text-xl font-bold" style={{ color: winningTeam.color }}>
                    {winningTeam.name} ({winningTeam.score} ұпай)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const { session: replay } = await api.createSession({
                    kind: 'space_race',
                    roomId: session.roomId,
                    quizId: session.quizId,
                    settings: session.settings,
                  });
                  onReplaySession(replay.id);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Қайта ойнау
              </button>
            </div>
          )}

          <SpaceRaceTrack
            teams={session.teams}
            icon={session.settings.spaceRaceIcon || 'rocket'}
          />
        </div>
      )}

      {/* VOTE CONTROL PANEL */}
      {session.kind === 'vote' && currentVote && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Кезең:{' '}
                {currentVote.phase === 'collecting'
                  ? '1. Жауаптар жинау'
                  : currentVote.phase === 'voting'
                  ? '2. Анонимді дауыс беру'
                  : '3. Нәтиже рейтингі'}
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                <RichText text={currentVote.prompt} />
              </h2>
            </div>

            {session.status !== 'ended' && (
              <div className="flex flex-wrap gap-2">
                {currentVote.phase === 'collecting' && (
                  <button
                    type="button"
                    disabled={currentVote.submissions.length === 0}
                    onClick={() => void api.updateVotePhase(session.id, 'voting')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 disabled:bg-slate-300 text-white text-sm font-semibold"
                  >
                    Дауыс беруді ашу ({currentVote.submissions.length})
                  </button>
                )}
                {currentVote.phase === 'voting' && (
                  <button
                    type="button"
                    onClick={() => void api.updateVotePhase(session.id, 'results')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold"
                  >
                    Нәтижені көрсету ({currentVote.ballots.length} дауыс)
                  </button>
                )}
              </div>
            )}
          </div>

          {currentVote.phase === 'collecting' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {currentVote.submissions.length === 0 ? (
                <p className="text-sm text-slate-500">Оқушылардың жауаптарын күтуде…</p>
              ) : (
                currentVote.submissions.map((sub, i) => (
                  <div
                    key={sub.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    <span className="font-mono text-xs text-slate-400 mr-2">#{i + 1}</span>
                    {sub.text}
                  </div>
                ))
              )}
            </div>
          ) : (
            <HorizontalBarChart
              items={[...currentVote.submissions]
                .map((sub) => ({
                  id: sub.id,
                  label: sub.text,
                  count: currentVote.ballots.filter((b) => b.submissionId === sub.id).length,
                }))
                .sort((a, b) => b.count - a.count)
                .map((it, idx) => ({ ...it, highlight: idx === 0 }))}
            />
          )}

          {session.status !== 'ended' && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newVotePrompt}
                onChange={(e) => setNewVotePrompt(e.target.value)}
                placeholder="Жаңа дауыс беру сұрағын бастау…"
                className="flex-1 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <button
                type="button"
                disabled={!newVotePrompt.trim()}
                onClick={async () => {
                  await api.updateVotePhase(session.id, 'collecting', newVotePrompt.trim());
                  setNewVotePrompt('');
                }}
                className="h-10 px-4 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-sm font-semibold disabled:opacity-40"
              >
                Жаңа раунд
              </button>
            </div>
          )}
        </div>
      )}

      {/* LIVE RESULTS MATRIX / STUDENT / QUESTION VIEWS (Quiz, Space Race, QuickQ, Exit Ticket) */}
      {session.kind !== 'vote' && questions.length > 0 && (
        <div className="space-y-4">
          {/* View Mode Segmented Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {(
                [
                  ['class', 'Сынып бойынша'],
                  ['question', 'Сұрақ бойынша'],
                  ['student', 'Оқушы бойынша'],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setViewTab(tab)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    viewTab === tab
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Дұрыс
              </span>
              <span className="inline-flex items-center gap-1 text-red-600">
                <XCircle className="w-3.5 h-3.5" /> Қате
              </span>
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> Тексеру
              </span>
            </div>
          </div>

          {/* CLASS TABLE VIEW */}
          {viewTab === 'class' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60">
                      <th className="py-3 px-4 text-left sticky left-0 bg-slate-50 dark:bg-slate-950 z-10 min-w-[180px]">
                        Оқушы ({activeStudents.length})
                      </th>
                      <th className="py-3 px-3 text-right">Нәтиже</th>
                      <th className="py-3 px-3 text-right">Уақыт</th>
                      {session.settings.proctoring?.enabled && (
                        <th className="py-3 px-3 text-center">Прокторинг</th>
                      )}
                      {questions.map((q, qi) => (
                        <th key={q.id} className="py-3 px-2 text-center font-mono min-w-[52px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedQuestionIdx(qi);
                              setViewTab('question');
                            }}
                            className="hover:text-emerald-600 underline-offset-2 hover:underline"
                          >
                            #{qi + 1}
                          </button>
                        </th>
                      ))}
                      <th className="py-3 px-3 text-right">Әрекет</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeStudents.length === 0 ? (
                      <tr>
                        <td
                          colSpan={questions.length + 5}
                          className="py-10 text-center text-slate-500"
                        >
                          Әзірге оқушылар қосылмады.
                        </td>
                      </tr>
                    ) : (
                      activeStudents.map((st) => {
                        let earned = 0;
                        let totalMs = 0;
                        for (const q of questions) {
                          const a = answersMap.get(`${st.id}:${q.id}`);
                          if (!a) continue;
                          earned += a.manualGrade ? a.manualGrade.points : a.points;
                          totalMs += a.timeSpentMs || 0;
                        }
                        const pct =
                          totalPointsPossible > 0
                            ? Math.round((earned / totalPointsPossible) * 100)
                            : 0;

                        return (
                          <tr
                            key={st.id}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                          >
                            <td className="py-2.5 px-4 sticky left-0 bg-white dark:bg-slate-900 z-10">
                              <div className="flex items-center gap-2">
                                <span
                                  title={st.connected ? 'Онлайн' : 'Ажыратылған'}
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    st.connected ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedStudentId(st.id);
                                    setViewTab('student');
                                  }}
                                  className="font-medium text-slate-900 dark:text-slate-100 hover:text-emerald-600 truncate max-w-[160px]"
                                >
                                  {st.displayName}
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                              {pct}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                              {formatDurationMs(totalMs)}
                            </td>
                            {session.settings.proctoring?.enabled && (
                              <td className="py-2.5 px-3 text-center">
                                {st.violations.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setViolationStudent(st)}
                                    className="inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline"
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    {st.violations.length}
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">0</span>
                                )}
                              </td>
                            )}
                            {questions.map((q) => {
                              const ans = answersMap.get(`${st.id}:${q.id}`);
                              if (!ans) {
                                return (
                                  <td key={q.id} className="p-1.5 text-center">
                                    <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800/70 text-slate-400 flex items-center justify-center text-xs">
                                      —
                                    </div>
                                  </td>
                                );
                              }
                              const isCorr = ans.manualGrade
                                ? ans.manualGrade.isCorrect
                                : ans.isCorrect;

                              return (
                                <td key={q.id} className="p-1.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => openGradeModal(st, q, ans)}
                                    title="Бағалау / қарау"
                                    className={`w-full h-9 px-1.5 rounded-lg flex items-center justify-center gap-1 text-xs font-mono font-semibold transition-opacity hover:opacity-85 ${
                                      isCorr === true
                                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                        : isCorr === false
                                        ? 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300'
                                        : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                                    }`}
                                  >
                                    {isCorr === true ? (
                                      <Check className="w-3.5 h-3.5" />
                                    ) : isCorr === false ? (
                                      <XCircle className="w-3.5 h-3.5" />
                                    ) : (
                                      <AlertTriangle className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                title="Қайта тапсыру мүмкіндігін беру"
                                onClick={() => void api.allowRetryStudent(session.id, st.id)}
                                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Бөлмеден шығару"
                                onClick={() => void api.kickStudent(session.id, st.id, false)}
                                className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* QUESTION VIEW */}
          {viewTab === 'question' && currentQuestion && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center gap-1.5">
                {questions.map((q, idx) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuestionIdx(idx)}
                    className={`w-9 h-9 rounded-lg font-mono text-xs font-bold border ${
                      idx === selectedQuestionIdx
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  <RichText text={currentQuestion.text} />
                </div>
                {currentQuestion.imageUrl && (
                  <img
                    src={currentQuestion.imageUrl}
                    alt="Сұрақ"
                    className="max-h-56 rounded-xl border bg-white"
                  />
                )}
              </div>

              <HorizontalBarChart items={getQuestionDistribution(currentQuestion)} />

              {/* Short-answer live grading list */}
              {currentQuestion.type === 'short_answer' && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-sm font-semibold">Оқушылардың қысқа жауаптары:</div>
                  {activeStudents.map((st) => {
                    const ans = answersMap.get(`${st.id}:${currentQuestion.id}`);
                    if (!ans) return null;
                    const effCorr = ans.manualGrade ? ans.manualGrade.isCorrect : ans.isCorrect;
                    return (
                      <div
                        key={ans.id}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-sm"
                      >
                        <div>
                          <div className="text-xs text-slate-500">{st.displayName}</div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {ans.value.join(', ')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openGradeModal(st, currentQuestion, ans)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            effCorr === true
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : effCorr === false
                              ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          }`}
                        >
                          {effCorr === true
                            ? `Дұрыс (${ans.points})`
                            : effCorr === false
                            ? 'Қате (0)'
                            : 'Бағалау'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STUDENT DETAIL VIEW */}
          {viewTab === 'student' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
              <select
                value={selectedStudentId || activeStudents[0]?.id || ''}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-medium"
              >
                {activeStudents.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.displayName} {st.studentCode ? `(${st.studentCode})` : ''}
                  </option>
                ))}
              </select>

              {(() => {
                const st =
                  activeStudents.find((x) => x.id === selectedStudentId) || activeStudents[0];
                if (!st) return <p className="text-sm text-slate-500">Оқушы жоқ.</p>;
                return (
                  <div className="space-y-3">
                    {questions.map((q, idx) => {
                      const ans = answersMap.get(`${st.id}:${q.id}`);
                      const effCorr = ans
                        ? ans.manualGrade
                          ? ans.manualGrade.isCorrect
                          : ans.isCorrect
                        : undefined;
                      return (
                        <div
                          key={q.id}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="font-medium text-sm">
                              <span className="font-mono text-slate-400 mr-1.5">{idx + 1}.</span>
                              <RichText text={q.text} />
                            </div>
                            <div className="text-xs text-slate-600 dark:text-slate-400">
                              Жауап: <strong>{ans ? ans.value.join(', ') : '—'}</strong>
                            </div>
                          </div>
                          {ans && (
                            <button
                              type="button"
                              onClick={() => openGradeModal(st, q, ans)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold shrink-0"
                            >
                              {effCorr === true ? '✓ Дұрыс' : effCorr === false ? '✗ Қате' : 'Бағалау'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Manual Grading Modal */}
      <Modal
        open={Boolean(gradeTarget)}
        onClose={() => setGradeTarget(null)}
        title="Жауапты қолмен бағалау"
        subtitle={gradeTarget?.student.displayName}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setGradeTarget(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitManualGrade()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Бағаны сақтау
            </button>
          </>
        }
      >
        {gradeTarget && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">Сұрақ</div>
              <div className="font-medium mt-0.5">
                <RichText text={gradeTarget.question.text} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <div className="text-xs text-slate-500">Оқушы жауабы</div>
              <div className="font-semibold text-base mt-0.5">
                {gradeTarget.answer.value.join(', ')}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setGradeCorrect(true);
                  setGradePoints(gradeTarget.question.points || 1);
                }}
                className={`flex-1 h-10 rounded-xl border font-semibold ${
                  gradeCorrect
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                Дұрыс
              </button>
              <button
                type="button"
                onClick={() => {
                  setGradeCorrect(false);
                  setGradePoints(0);
                }}
                className={`flex-1 h-10 rounded-xl border font-semibold ${
                  !gradeCorrect
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                Қате
              </button>
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-slate-500">
                Балл (жартылай балл қоюға болады, макс {gradeTarget.question.points})
              </label>
              <input
                type="number"
                step={0.5}
                min={0}
                max={gradeTarget.question.points || 100}
                value={gradePoints}
                onChange={(e) => setGradePoints(Math.max(0, Number(e.target.value) || 0))}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
              />
            </div>

            {gradeTarget.question.type === 'short_answer' && gradeCorrect && (
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gradeAcceptForAll}
                  onChange={(e) => setGradeAcceptForAll(e.target.checked)}
                  className="accent-emerald-600"
                />
                Осы жауапты барлық оқушылар үшін дұрыс деп санау
              </label>
            )}
          </div>
        )}
      </Modal>

      {/* Proctoring Violations Log Modal */}
      <Modal
        open={Boolean(violationStudent)}
        onClose={() => setViolationStudent(null)}
        title={`Прокторинг журналы: ${violationStudent?.displayName}`}
        size="sm"
      >
        {violationStudent && (
          <div className="space-y-2">
            {violationStudent.violations.map((v, i) => (
              <div
                key={v.id}
                className="p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-semibold text-amber-900 dark:text-amber-300">
                    #{i + 1} · {v.type}
                  </div>
                  {v.details && <div className="text-slate-600 dark:text-slate-400">{v.details}</div>}
                </div>
                <span className="font-mono text-slate-500">
                  {new Date(v.at).toLocaleTimeString('kk-KZ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Add Next Quick Question Modal */}
      <Modal
        open={qqOpen}
        onClose={() => setQqOpen(false)}
        title="Келесі жылдам сұрақ қосу"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setQqOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                const { session: updated } = await api.addQuickQuestion(session.id, {
                  type: qqType,
                  text: qqText,
                });
                setSession(updated);
                setQqText('');
                setQqOpen(false);
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Жіберу
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['multiple_choice', 'A/B/C/D'],
                ['true_false', 'Дұрыс/Қате'],
                ['short_answer', 'Қысқа'],
              ] as const
            ).map(([tp, lbl]) => (
              <button
                key={tp}
                type="button"
                onClick={() => setQqType(tp)}
                className={`py-2 rounded-lg border text-xs font-semibold ${
                  qqType === tp ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={qqText}
            onChange={(e) => setQqText(e.target.value)}
            placeholder="Сұрақ мәтіні (немесе бос қалдырыңыз)"
            className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={endConfirmOpen}
        danger
        title="Сессияны аяқтау"
        message="Сессия аяқталған соң барлық жауаптар сақталып, автоматты түрде есеп құрылады. Жалғастырасыз ба?"
        confirmLabel="Аяқтау"
        onCancel={() => setEndConfirmOpen(false)}
        onConfirm={async () => {
          const { session: ended } = await api.endSession(session.id);
          setSession(ended);
          setEndConfirmOpen(false);
          toast.success('Сессия аяқталды — есеп дайын');
        }}
      />

      <RoomQrModal open={qrOpen} onClose={() => setQrOpen(false)} roomName={session.roomName} />
    </div>
  );
};
