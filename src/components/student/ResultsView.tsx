import React, { useState } from 'react';
import {
  CheckCircle2,
  Printer,
  RotateCcw,
  Trophy,
  XCircle,
  Clock,
  LogOut,
} from 'lucide-react';
import type { StudentSessionView } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { useToast } from '../shared/Toast.tsx';
import { RichText } from '../shared/RichText.tsx';
import { SpaceRaceTrack } from '../shared/Charts.tsx';

export const ResultsView: React.FC<{
  view: StudentSessionView;
  studentToken: string;
  onViewUpdate: (v: StudentSessionView) => void;
  onExit: () => void;
}> = ({ view, studentToken, onViewUpdate, onExit }) => {
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await api.studentRetry(studentToken);
      onViewUpdate(res.view);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const winningTeam =
    view.teams && view.teams.length > 0
      ? [...view.teams].sort((a, b) => b.score - a.score)[0]
      : null;

  return (
    <div className="space-y-6 pb-8">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <Trophy className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Тапсырма аяқталды!
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {view.title} · {view.student.displayName}
          </p>
        </div>

        {view.student.autoClosedByProctoring && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
            Прокторинг ескертулерінің лимиті толғандықтан жұмыс автоматты жабылды.
          </div>
        )}

        {view.finalSummary && view.settings.showFinalScore ? (
          <div className="grid grid-cols-3 gap-3 pt-2 max-w-md mx-auto">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <div className="text-xs text-slate-500 dark:text-slate-400">Нәтиже</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {view.finalSummary.percent}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <div className="text-xs text-slate-500 dark:text-slate-400">Балл</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {view.finalSummary.earnedPoints}/{view.finalSummary.totalPointsPossible}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <div className="text-xs text-slate-500 dark:text-slate-400">Дұрыс</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {view.finalSummary.correctCount}/{view.finalSummary.totalQuestions}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Жауаптарыңыз сәтті сақталды. Қорытынды бағаны мұғалім жариялайды.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-3 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium inline-flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Printer className="w-4 h-4" />
            PDF сақтау
          </button>
          {view.settings.allowRetry && view.status === 'running' && (
            <button
              type="button"
              disabled={retrying}
              onClick={handleRetry}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Қайта тапсыру
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium inline-flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4" />
            Бөлмеден шығу
          </button>
        </div>
      </div>

      {/* Space Race Winner */}
      {view.kind === 'space_race' && view.teams && winningTeam && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
            Жеңімпаз команда: <span style={{ color: winningTeam.color }}>{winningTeam.name}</span>
          </h2>
          <SpaceRaceTrack
            teams={view.teams}
            icon={view.settings.spaceRaceIcon || 'rocket'}
            myTeamId={view.student.teamId}
          />
        </div>
      )}

      {/* Detailed Answer Review */}
      {view.settings.showFinalScore && view.questions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
            Сұрақтар бойынша шолу
          </h2>
          {view.questions.map((q, idx) => {
            const ans = view.myAnswers[q.id];
            const effCorrect = ans?.manualGrade ? ans.manualGrade.isCorrect : ans?.isCorrect;
            const effPts = ans?.manualGrade ? ans.manualGrade.points : ans?.points ?? 0;

            const formatVal = (vals?: string[]) => {
              if (!vals || vals.length === 0) return 'Жауап берілмеді';
              if (q.type === 'short_answer') return vals.join(', ');
              if (q.type === 'true_false') {
                return vals.map((v) => (v === 'true' ? 'Дұрыс' : 'Қате')).join(', ');
              }
              return vals
                .map((id) => {
                  const o = q.options?.find((x) => x.id === id);
                  return o ? `${id.toUpperCase()}) ${o.text}` : id.toUpperCase();
                })
                .join('; ');
            };

            return (
              <div
                key={q.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2 print-avoid-break"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    <span className="font-mono text-slate-400 mr-1.5">{idx + 1}.</span>
                    <RichText text={q.text} />
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5 text-xs font-mono font-semibold">
                    {effCorrect === true ? (
                      <span className="text-emerald-600 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> +{effPts}
                      </span>
                    ) : effCorrect === false ? (
                      <span className="text-red-600 inline-flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> 0
                      </span>
                    ) : (
                      <span className="text-amber-600 inline-flex items-center gap-1">
                        <Clock className="w-4 h-4" /> Тексеруде
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Сіздің жауабыңыз:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    <RichText text={formatVal(ans?.value)} />
                  </strong>
                </div>

                {q.correct && q.correct.length > 0 && effCorrect !== true && (
                  <div className="text-sm text-emerald-700 dark:text-emerald-400">
                    Дұрыс жауап: <RichText text={formatVal(q.correct)} />
                  </div>
                )}

                {q.explanation && (
                  <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <RichText text={q.explanation} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
