import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  FilePlus2,
  Play,
  QrCode,
  Radio,
  Ticket,
  Zap,
} from 'lucide-react';
import type { PublicTeacher, Room } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { copyToClipboard, formatDateShort } from '../../lib/utils.ts';
import { useI18n } from '../../lib/i18n.ts';
import { RoomQrModal } from '../shared/TopControls.tsx';
import { useToast } from '../shared/Toast.tsx';

interface SessionRow {
  id: string;
  roomName: string;
  kind: string;
  title: string;
  status: string;
  startedAt: string;
  studentCount: number;
  averagePercent: number;
}

export const Dashboard: React.FC<{
  teacher: PublicTeacher;
  onOpenLaunch: (preset?: 'quiz' | 'space_race' | 'quick_question' | 'exit_ticket' | 'vote') => void;
  onNewQuiz: () => void;
  onOpenLive: (sessionId: string) => void;
  onOpenReport: (sessionId: string) => void;
}> = ({ teacher, onOpenLaunch, onNewQuiz, onOpenLive, onOpenReport }) => {
  const { t } = useI18n();
  const toast = useToast();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [quizCount, setQuizCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getRooms(), api.getSessions(), api.getQuizzes(false)])
      .then(([rRes, sRes, qRes]) => {
        if (!active) return;
        setRooms(rRes.rooms);
        setSessions(sRes.sessions);
        setQuizCount(qRes.quizzes.length);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const persistentRoom = rooms.find((r) => r.isPersistent) || teacher.persistentRoom;
  const activeSession = sessions.find((s) => s.status !== 'ended');
  const endedSessions = sessions.filter((s) => s.status === 'ended');
  const avgPercent =
    endedSessions.length > 0
      ? Math.round(
          (endedSessions.reduce((acc, s) => acc + s.averagePercent, 0) / endedSessions.length) * 10
        ) / 10
      : 0;

  const handleCopyRoom = async () => {
    if (!persistentRoom) return;
    if (await copyToClipboard(persistentRoom.name)) {
      setCopied(true);
      toast.success(`«${persistentRoom.name}» көшірілді`);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="space-y-8">
      {/* Active Session Banner */}
      {activeSession && (
        <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Radio className="w-4 h-4" />
              <span>{t('active_session')} · Бөлме: {activeSession.roomName}</span>
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {activeSession.title}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              Оқушылар: {activeSession.studentCount} · Басталды: {formatDateShort(activeSession.startedAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenLive(activeSession.id)}
            className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" />
            {t('resume_session')}
          </button>
        </div>
      )}

      {/* Hero Permanent Room Card + KPI Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-6">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('my_room')}
            </div>
            <div className="font-mono text-4xl sm:text-5xl font-bold tracking-wider text-slate-900 dark:text-slate-100 select-all">
              {persistentRoom?.name || '—'}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Оқушылар телефон немесе ноутбуктен осы атаумен кіреді — бөлме атауын «Бөлмелер» бөлімінде өзгерте аласыз.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCopyRoom}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('copied') : t('copy_code')}
            </button>
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap"
            >
              <QrCode className="w-4 h-4" />
              {t('qr_link')}
            </button>
          </div>
        </div>

        {/* Summary Statistics */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-5">
          <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
            Қысқа статистика
          </h2>
          {loading ? (
            <div className="grid grid-cols-3 gap-4 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 divide-x divide-slate-100 dark:divide-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{t('stat_quizzes')}</div>
                <div className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {quizCount}
                </div>
              </div>
              <div className="pl-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">{t('stat_sessions')}</div>
                <div className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {sessions.length}
                </div>
              </div>
              <div className="pl-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">{t('stat_avg')}</div>
                <div className="text-3xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {avgPercent}%
                </div>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{teacher.name}</span>
            <span>{teacher.email}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
          {t('quick_actions')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={onNewQuiz}
            className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-600 text-left space-y-2 transition-colors"
          >
            <FilePlus2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div className="font-semibold text-slate-900 dark:text-slate-100">{t('new_quiz')}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Формула және сурет қосылған жаңа тест құру
            </p>
          </button>

          <button
            type="button"
            onClick={() => onOpenLaunch('quiz')}
            className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-600 text-left space-y-2 transition-colors"
          >
            <Play className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div className="font-semibold text-slate-900 dark:text-slate-100">Викторина бастау</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Кітапханадағы тестті сыныппен тірі өткізу
            </p>
          </button>

          <button
            type="button"
            onClick={() => onOpenLaunch('quick_question')}
            className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-600 text-left space-y-2 transition-colors"
          >
            <Zap className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {t('act_quick_question')}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Сабақ үстінде A/B/C/D немесе қысқа сұрақ қою
            </p>
          </button>

          <button
            type="button"
            onClick={() => onOpenLaunch('exit_ticket')}
            className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-600 text-left space-y-2 transition-colors"
          >
            <Ticket className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {t('act_exit_ticket')}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Сабақ соңындағы 3 сұрақтық рефлексия
            </p>
          </button>
        </div>
      </section>

      {/* Recent 5 Sessions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
            {t('recent_sessions')}
          </h2>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Әзірге өткізілген сабақтар жоқ. Бірінші викторинаны қазір іске қосыңыз!
              </p>
              <button
                type="button"
                onClick={() => onOpenLaunch('quiz')}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                Сабақ бастау
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4">Атауы</th>
                    <th className="py-3 px-4">Бөлме</th>
                    <th className="py-3 px-4">Күні</th>
                    <th className="py-3 px-4 text-right">Оқушы</th>
                    <th className="py-3 px-4 text-right">Орташа</th>
                    <th className="py-3 px-4 text-right">Әрекет</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sessions.slice(0, 5).map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {s.title}
                        <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                          · {s.kind}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {s.roomName}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatDateShort(s.startedAt)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {s.studentCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {s.averagePercent}%
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            s.status !== 'ended' ? onOpenLive(s.id) : onOpenReport(s.id)
                          }
                          className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                        >
                          {s.status !== 'ended' ? 'Тірі басқару' : 'Есепті ашу'}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {persistentRoom && (
        <RoomQrModal open={qrOpen} onClose={() => setQrOpen(false)} roomName={persistentRoom.name} />
      )}
    </div>
  );
};
