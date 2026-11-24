import React, { useState } from 'react';
import { Check, CheckCircle2, Send, Vote as VoteIcon } from 'lucide-react';
import type { StudentSessionView } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { useToast } from '../shared/Toast.tsx';
import { HorizontalBarChart } from '../shared/Charts.tsx';
import { RichText } from '../shared/RichText.tsx';

export const VoteView: React.FC<{
  view: StudentSessionView;
  studentToken: string;
  onViewUpdate: (v: StudentSessionView) => void;
}> = ({ view, studentToken, onViewUpdate }) => {
  const toast = useToast();
  const round = view.activeVote;
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!round) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-600 dark:text-slate-400">
        Мұғалім дауыс беру сұрағын ашқанша күтіңіз…
      </div>
    );
  }

  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.studentVoteSubmit(studentToken, text.trim());
      onViewUpdate(res.view);
      toast.success('Жауабыңыз жіберілді!');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (submissionId: string) => {
    setSubmitting(true);
    try {
      const res = await api.studentVoteBallot(studentToken, submissionId);
      onViewUpdate(res.view);
      toast.success('Дауысыңыз есептелді!');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
      <div className="space-y-1">
        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {round.phase === 'collecting'
            ? '1-кезең · Жауаптар жинау'
            : round.phase === 'voting'
            ? '2-кезең · Ең үздігіне дауыс беріңіз'
            : 'Нәтижелер'}
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          <RichText text={round.prompt} />
        </h1>
      </div>

      {round.phase === 'collecting' && (
        <form onSubmit={handleSubmitIdea} className="space-y-3">
          {round.mySubmissionId && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Жауабыңыз қабылданды. Қаласаңыз төменде жаңарта аласыз.</span>
            </div>
          )}
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Қысқа жауабыңызды жазыңыз…"
            className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-base text-slate-900 dark:text-slate-100 focus:border-emerald-600 outline-none"
          />
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold inline-flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {round.mySubmissionId ? 'Жауапты жаңарту' : 'Жауапты жіберу'}
          </button>
        </form>
      )}

      {round.phase === 'voting' && (
        <div className="space-y-2.5">
          {round.submissions.length === 0 ? (
            <p className="text-sm text-slate-500">Жауаптар жоқ.</p>
          ) : (
            round.submissions.map((sub) => {
              const voted = round.myBallotSubmissionId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleVote(sub.id)}
                  className={`w-full min-h-[54px] p-4 rounded-xl border-2 text-left flex items-center justify-between gap-3 transition-colors ${
                    voted
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                      : 'border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                  }`}
                >
                  <span className="text-base text-slate-900 dark:text-slate-100">{sub.text}</span>
                  {voted ? (
                    <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <VoteIcon className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      {round.phase === 'results' && (
        <HorizontalBarChart
          items={[...round.submissions]
            .sort((a, b) => (b.votes || 0) - (a.votes || 0))
            .map((sub, idx) => ({
              id: sub.id,
              label: sub.text,
              count: sub.votes || 0,
              highlight: idx === 0,
            }))}
        />
      )}
    </div>
  );
};
