import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { StudentSessionView, ViolationType } from '../../types.ts';
import { formatCountdown } from '../../lib/utils.ts';
import { RichText } from '../shared/RichText.tsx';
import { SpaceRaceTrack } from '../shared/Charts.tsx';
import { useI18n } from '../../lib/i18n.ts';

interface QuizRunnerProps {
  view: StudentSessionView;
  proctoringActive: boolean;
  onSubmitAnswer: (questionId: string, value: string[], timeSpentMs: number) => Promise<void>;
  onFinish: () => Promise<void>;
  onViolation: (type: ViolationType, details?: string) => Promise<void>;
}

export const QuizRunner: React.FC<QuizRunnerProps> = ({
  view,
  proctoringActive,
  onSubmitAnswer,
  onFinish,
  onViolation,
}) => {
  const { t } = useI18n();
  const isTeacherPaced =
    view.settings.pacing === 'teacher_paced' || view.kind === 'quick_question';
  const isForwardOnly = view.settings.pacing === 'student_paced_forward';

  const [localIndex, setLocalIndex] = useState(0);
  const currentIdx = isTeacherPaced
    ? Math.min(view.currentQuestionIndex, Math.max(0, view.questions.length - 1))
    : Math.min(localIndex, Math.max(0, view.questions.length - 1));

  const question = view.questions[currentIdx];
  const existingAnswer = question ? view.myAnswers[question.id] : undefined;

  const [selected, setSelected] = useState<string[]>([]);
  const [shortText, setShortText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [localQuestionSecondsLeft, setLocalQuestionSecondsLeft] = useState<number | null>(null);
  const questionStartRef = useRef<number>(Date.now());
  const violationDebounceRef = useRef<number>(0);

  // Sync draft state when changing question
  useEffect(() => {
    if (!question) return;
    questionStartRef.current = Date.now();
    const saved = view.myAnswers[question.id];
    if (question.type === 'short_answer') {
      setShortText(saved?.value?.[0] || '');
      setSelected([]);
    } else {
      setSelected(saved?.value || []);
      setShortText('');
    }
    const perQ = question.timeLimitSeconds || view.settings.perQuestionSeconds;
    if (!isTeacherPaced && perQ && !saved) {
      setLocalQuestionSecondsLeft(perQ);
    } else {
      setLocalQuestionSecondsLeft(null);
    }
  }, [question?.id, isTeacherPaced, view.settings.perQuestionSeconds]);

  // Countdown tick
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
      setLocalQuestionSecondsLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-advance / auto-submit when student-paced per-question timer expires
  useEffect(() => {
    if (localQuestionSecondsLeft !== 0 || !question || isTeacherPaced) return;
    const autoSend = async () => {
      if (!view.myAnswers[question.id]) {
        const val =
          question.type === 'short_answer'
            ? [shortText.trim()]
            : selected;
        if (val.some(Boolean)) {
          await onSubmitAnswer(question.id, val, Date.now() - questionStartRef.current);
        }
      }
      if (currentIdx < view.questions.length - 1) {
        setLocalIndex((i) => i + 1);
      } else {
        await onFinish();
      }
    };
    void autoSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localQuestionSecondsLeft]);

  // Proctoring event listeners
  useEffect(() => {
    if (!proctoringActive || !view.settings.proctoring?.enabled) return;
    const proct = view.settings.proctoring;

    const reportDebounced = (type: ViolationType, details?: string) => {
      const now = Date.now();
      if (now - violationDebounceRef.current < 1500) return;
      violationDebounceRef.current = now;
      void onViolation(type, details);
    };

    const onVisibility = () => {
      if (document.hidden && proct.detectTabSwitch) {
        reportDebounced('tab_switch', 'Қойындыдан шықты');
      }
    };
    const onBlur = () => {
      if (proct.detectTabSwitch) {
        reportDebounced('window_blur', 'Терезе фокусы жоғалды');
      }
    };
    const onFsChange = () => {
      if (proct.requireFullscreen && !document.fullscreenElement) {
        reportDebounced('fullscreen_exit', 'Толық экраннан шықты');
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (proct.blockCopyPaste) {
        e.preventDefault();
        reportDebounced('copy_attempt', 'Көшіру әрекеті');
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (proct.blockCopyPaste) {
        e.preventDefault();
        reportDebounced('paste_attempt', 'Қою әрекеті');
      }
    };
    const onContext = (e: MouseEvent) => {
      if (proct.blockCopyPaste) {
        e.preventDefault();
        reportDebounced('context_menu', 'Оң батырма');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContext);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [proctoringActive, view.settings.proctoring, onViolation]);

  if (!question) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center">
        <p className="text-slate-600 dark:text-slate-400">Мұғалім келесі сұрақты қосқанша күтіңіз…</p>
      </div>
    );
  }

  const isMultiSelect =
    question.type === 'multiple_choice' &&
    question.multiCorrectMode === 'partial' ||
    (question.correct && question.correct.length > 1);
  const locked = Boolean(existingAnswer) && isForwardOnly;

  const overallTimerStr = formatCountdown(view.timerEndsAt);
  const qTimerStr = isTeacherPaced
    ? formatCountdown(view.questionTimerEndsAt)
    : localQuestionSecondsLeft !== null
    ? `${Math.floor(localQuestionSecondsLeft / 60)
        .toString()
        .padStart(2, '0')}:${(localQuestionSecondsLeft % 60).toString().padStart(2, '0')}`
    : null;
  void nowTick;

  const toggleOption = (id: string) => {
    if (locked) return;
    if (question.type === 'true_false') {
      setSelected([id]);
      return;
    }
    if (isMultiSelect) {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelected([id]);
    }
  };

  const handleSubmit = async () => {
    const val = question.type === 'short_answer' ? [shortText.trim()] : selected;
    if (val.length === 0 || (question.type === 'short_answer' && !val[0])) return;
    setSubmitting(true);
    try {
      await onSubmitAnswer(question.id, val, Date.now() - questionStartRef.current);
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = Object.keys(view.myAnswers).length;
  const totalCount = view.questions.length;
  const progressPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const myTeam = view.teams?.find((tm) => tm.id === view.student.teamId);
  const myTeamRank =
    view.teams && myTeam
      ? [...view.teams]
          .sort((a, b) => b.score - a.score)
          .findIndex((tm) => tm.id === myTeam.id) + 1
      : null;

  const showFeedback =
    Boolean(existingAnswer) &&
    (view.settings.showFeedbackAfterEach ||
      (isTeacherPaced && Boolean(view.settings.revealCorrectAnswer)));

  return (
    <div
      className={`space-y-4 ${
        proctoringActive && view.settings.proctoring?.blockCopyPaste ? 'select-none' : ''
      }`}
    >
      {/* Space Race Team Banner */}
      {view.kind === 'space_race' && myTeam && view.teams && (
        <div
          className="rounded-2xl border p-4 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
          style={{ borderColor: myTeam.color }}
        >
          <div className="flex items-center gap-3">
            <span
              className="w-5 h-5 rounded-md shrink-0"
              style={{ backgroundColor: myTeam.color }}
            />
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Командаңыз</div>
              <div className="font-bold text-slate-900 dark:text-slate-100">{myTeam.name}</div>
            </div>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-xs text-slate-500 dark:text-slate-400">Орын</div>
            <div className="font-bold text-lg text-slate-900 dark:text-slate-100">
              #{myTeamRank} · {myTeam.progress}%
            </div>
          </div>
        </div>
      )}

      {/* Proctoring warning bar */}
      {proctoringActive && view.student.violations.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs sm:text-sm text-amber-800 dark:text-amber-300">
          <span className="inline-flex items-center gap-2 font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Ескертулер: {view.student.violations.length}
            {view.settings.proctoring?.maxViolations
              ? ` / ${view.settings.proctoring.maxViolations}`
              : ''}
          </span>
          {view.settings.proctoring?.requireFullscreen && !document.fullscreenElement && (
            <button
              type="button"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
              className="underline font-semibold whitespace-nowrap"
            >
              Толық экранға қайту
            </button>
          )}
        </div>
      )}

      {/* Progress & Timer header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          <span className="font-medium font-mono tabular-nums">
            Сұрақ {currentIdx + 1} / {totalCount}
          </span>
          <div className="flex items-center gap-3 font-mono tabular-nums">
            {qTimerStr && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                <Clock className="w-3.5 h-3.5" />
                {qTimerStr}
              </span>
            )}
            {overallTimerStr && (
              <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 font-semibold">
                <Clock className="w-3.5 h-3.5" />
                {overallTimerStr}
              </span>
            )}
          </div>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="space-y-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>{t(`qt_${question.type}`)}</span>
            {question.points > 0 && (
              <>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  {question.points} {t('points')}
                </span>
              </>
            )}
          </div>

          <div className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 leading-relaxed">
            <RichText text={question.text} />
          </div>

          {question.imageUrl && (
            <div className="pt-1">
              <img
                src={question.imageUrl}
                alt="Сұрақ суреті"
                className="max-h-72 rounded-xl border border-slate-200 dark:border-slate-800 object-contain mx-auto bg-white"
              />
            </div>
          )}
        </div>

        {/* Answer Input */}
        {question.type === 'short_answer' ? (
          <div className="space-y-2">
            <textarea
              rows={3}
              disabled={locked}
              value={shortText}
              onChange={(e) => setShortText(e.target.value)}
              placeholder="Жауабыңызды осында жазыңыз…"
              className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-base text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none disabled:opacity-60"
            />
          </div>
        ) : (
          <div className="space-y-2.5">
            {question.options?.map((opt) => {
              const isChosen = selected.includes(opt.id);
              const isRightOpt = showFeedback && question.correct?.includes(opt.id);
              const isWrongChosen =
                showFeedback && isChosen && question.correct && !question.correct.includes(opt.id);

              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={locked}
                  onClick={() => toggleOption(opt.id)}
                  className={`w-full min-h-[54px] px-4 py-3.5 rounded-xl border-2 text-left flex items-center gap-3.5 transition-all ${
                    isRightOpt
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                      : isWrongChosen
                      ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                      : isChosen
                      ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 border ${
                      isChosen
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {isChosen ? (
                      <Check className="w-4 h-4" />
                    ) : question.type === 'true_false' ? (
                      opt.id === 'true' ? 'Д' : 'Қ'
                    ) : (
                      opt.id.toUpperCase()
                    )}
                  </span>
                  <span className="flex-1 text-base text-slate-900 dark:text-slate-100 leading-snug">
                    <RichText text={opt.text} />
                  </span>
                  {isRightOpt && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                  {isWrongChosen && <XCircle className="w-5 h-5 text-red-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Submit Button */}
        {!locked && (
          <button
            type="button"
            disabled={
              submitting ||
              (question.type === 'short_answer' ? !shortText.trim() : selected.length === 0)
            }
            onClick={handleSubmit}
            className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-base inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>{existingAnswer ? 'Жауапты жаңарту' : t('submit')}</span>
          </button>
        )}

        {/* Immediate Feedback */}
        {existingAnswer && (
          <div
            className={`p-4 rounded-xl border text-sm space-y-1.5 ${
              !showFeedback
                ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                : existingAnswer.isCorrect === true
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                : existingAnswer.isCorrect === false
                ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
                : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="font-semibold flex items-center gap-2">
              {!showFeedback ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Жауабыңыз қабылданды!</span>
                </>
              ) : existingAnswer.isCorrect === true ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t('correct')} (+{existingAnswer.points} {t('points')})</span>
                </>
              ) : existingAnswer.isCorrect === false ? (
                <>
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span>{t('incorrect')}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Жауап қабылданды — мұғалім тексереді</span>
                </>
              )}
            </div>
            {showFeedback && question.explanation && (
              <div className="text-slate-700 dark:text-slate-300 pt-1">
                <RichText text={question.explanation} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation bar for student-paced modes */}
      {!isTeacherPaced && (
        <div className="flex items-center justify-between gap-3 pt-1">
          {!isForwardOnly ? (
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setLocalIndex((i) => Math.max(0, i - 1))}
              className="h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('prev')}
            </button>
          ) : (
            <div />
          )}

          {currentIdx < totalCount - 1 ? (
            <button
              type="button"
              disabled={isForwardOnly && !existingAnswer}
              onClick={() => setLocalIndex((i) => Math.min(totalCount - 1, i + 1))}
              className="h-12 px-5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {t('next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={isForwardOnly && !existingAnswer}
              onClick={() => void onFinish()}
              className="h-12 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-2 disabled:opacity-40"
            >
              <CheckCircle2 className="w-4 h-4" />
              {t('finish')}
            </button>
          )}
        </div>
      )}

      {/* Compact question jumper for open navigation */}
      {!isTeacherPaced && !isForwardOnly && totalCount > 1 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {view.questions.map((q, idx) => {
            const isAns = Boolean(view.myAnswers[q.id]);
            const isCurr = idx === currentIdx;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setLocalIndex(idx)}
                className={`w-10 h-10 rounded-lg font-mono text-xs font-semibold border transition-colors ${
                  isCurr
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : isAns
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      )}

      {/* Space Race Mini Leaderboard below student question */}
      {view.kind === 'space_race' && view.teams && (
        <div className="pt-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
            Командалар жарысы
          </div>
          <SpaceRaceTrack
            teams={view.teams}
            icon={view.settings.spaceRaceIcon || 'rocket'}
            myTeamId={view.student.teamId}
          />
        </div>
      )}
    </div>
  );
};
