import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { Session, SessionReportSummary } from '../../types.ts';
import { api, downloadAuthenticatedFile } from '../../lib/api.ts';
import { formatDateShort, formatDurationMs } from '../../lib/utils.ts';
import { useI18n } from '../../lib/i18n.ts';
import { HorizontalBarChart, ProgressLineChart } from '../shared/Charts.tsx';
import { ConfirmDialog } from '../shared/Modal.tsx';
import { RichText } from '../shared/RichText.tsx';
import { useToast } from '../shared/Toast.tsx';

interface SessionListItem {
  id: string;
  roomName: string;
  kind: string;
  title: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  studentCount: number;
  averagePercent: number;
  pendingManualCount: number;
}

export const Reports: React.FC<{
  aiEnabled: boolean;
  initialSessionId?: string | null;
  onOpenLive: (sessionId: string) => void;
}> = ({ aiEnabled, initialSessionId = null, onOpenLive }) => {
  const { t, locale } = useI18n();
  const toast = useToast();

  const [mode, setMode] = useState<'sessions' | 'progress'>('sessions');
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Selected Report Detail
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId);
  const [detailSession, setDetailSession] = useState<Session | null>(null);
  const [report, setReport] = useState<SessionReportSummary | null>(null);
  const [detailTab, setDetailTab] = useState<'class' | 'students' | 'questions'>('class');
  const [aiLoading, setAiLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Student Progress
  const [progressQuery, setProgressQuery] = useState('');
  const [progressList, setProgressList] = useState<
    {
      key: string;
      displayName: string;
      studentCode?: string;
      points: { sessionId: string; title: string; date: string; percent: number; score: number }[];
    }[]
  >([]);
  const [activeProgressKey, setActiveProgressKey] = useState<string>('');

  const loadList = async () => {
    try {
      const { sessions: list } = await api.getSessions();
      setSessions(list);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (initialSessionId) setSelectedId(initialSessionId);
  }, [initialSessionId]);

  useEffect(() => {
    if (!selectedId) return;
    api
      .getSessionReport(selectedId)
      .then((res) => {
        setDetailSession(res.session);
        setReport(res.report);
      })
      .catch((err) => toast.error((err as Error).message));
  }, [selectedId, toast]);

  useEffect(() => {
    if (mode !== 'progress') return;
    api
      .getStudentProgress(progressQuery)
      .then((res) => {
        setProgressList(res.students);
        if (res.students[0] && !activeProgressKey) {
          setActiveProgressKey(res.students[0].key);
        }
      })
      .catch(() => {});
  }, [mode, progressQuery]);

  const uniqueRooms = useMemo(
    () => [...new Set(sessions.map((s) => s.roomName))],
    [sessions]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
      if (roomFilter !== 'all' && s.roomName !== roomFilter) return false;
      if (dateFrom && s.startedAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && s.startedAt.slice(0, 10) > dateTo) return false;
      if (q && !s.title.toLowerCase().includes(q) && !s.roomName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sessions, search, kindFilter, roomFilter, dateFrom, dateTo]);

  // =========================================================================
  // DETAILED SESSION REPORT VIEW
  // =========================================================================
  if (selectedId && report && detailSession) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setReport(null);
              }}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                {report.title}
              </h1>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Бөлме: {report.roomName} · {formatDateShort(report.startedAt)} · Оқушылар:{' '}
                {report.studentCount}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedFile(
                  `/api/sessions/${report.sessionId}/export.xlsx`,
                  `${report.title}_report.xlsx`
                )
              }
              className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedFile(
                  `/api/sessions/${report.sessionId}/export.docx`,
                  `${report.title}_report.docx`
                )
              }
              className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              Word (.docx)
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedFile(
                  `/api/sessions/${report.sessionId}/export.csv`,
                  `${report.title}_report.csv`
                )
              }
              className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              PDF / Баспа
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div className="text-xs text-slate-500">Орташа нәтиже</div>
            <div className="text-2xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
              {report.averagePercent}%
            </div>
            <div className="text-xs text-slate-500 font-mono">
              {report.averageScore} / {report.totalPointsPossible} ұпай
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div className="text-xs text-slate-500">Медиана</div>
            <div className="text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {report.medianPercent}%
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div className="text-xs text-slate-500">Орташа уақыт</div>
            <div className="text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {formatDurationMs(report.averageTimeMs)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div className="text-xs text-slate-500">Қолмен тексеруде</div>
            <div className="text-2xl font-mono font-bold tabular-nums text-amber-600 mt-1">
              {report.pendingManualCount}
            </div>
          </div>
        </div>

        {/* AI Class Analysis */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              Сынып бойынша AI талдау
            </div>
            <button
              type="button"
              disabled={!aiEnabled || aiLoading}
              title={!aiEnabled ? t('ai_disabled_notice') : ''}
              onClick={async () => {
                setAiLoading(true);
                try {
                  const { analysis } = await api.aiAnalyzeSession(report.sessionId, locale);
                  setReport({ ...report, aiAnalysis: analysis });
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setAiLoading(false);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-semibold inline-flex items-center gap-1.5 no-print"
            >
              {aiLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {report.aiAnalysis ? 'Қайта талдау' : 'Талдау жасау'}
            </button>
          </div>
          {report.aiAnalysis ? (
            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
              {report.aiAnalysis}
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {aiEnabled
                ? 'Қай тақырып әлсіз және нені қайталау керектігін жылдам білу үшін «Талдау жасау» батырмасын басыңыз.'
                : t('ai_disabled_notice')}
            </p>
          )}
        </div>

        {/* Subtabs */}
        <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 no-print">
          {(
            [
              ['class', 'Жалпы сынып'],
              ['students', 'Оқушылар бойынша'],
              ['questions', 'Сұрақтар бойынша'],
            ] as const
          ).map(([tb, lbl]) => (
            <button
              key={tb}
              type="button"
              onClick={() => setDetailTab(tb)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                detailTab === tb
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {detailTab === 'class' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h2 className="font-semibold text-sm text-red-700 dark:text-red-400">
                Ең қиын сұрақтар
              </h2>
              {report.hardestQuestions.length === 0 ? (
                <p className="text-xs text-slate-500">Дерек жоқ</p>
              ) : (
                report.hardestQuestions.map((q) => (
                  <div
                    key={q.questionId}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      #{q.order + 1} <RichText text={q.text} />
                    </span>
                    <span className="font-mono font-bold text-red-600 shrink-0">
                      {q.accuracyPercent}%
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h2 className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                Ең оңай сұрақтар
              </h2>
              {report.easiestQuestions.length === 0 ? (
                <p className="text-xs text-slate-500">Дерек жоқ</p>
              ) : (
                report.easiestQuestions.map((q) => (
                  <div
                    key={q.questionId}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      #{q.order + 1} <RichText text={q.text} />
                    </span>
                    <span className="font-mono font-bold text-emerald-600 shrink-0">
                      {q.accuracyPercent}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {detailTab === 'students' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 text-left">
                    <th className="py-3 px-4">Оқушы</th>
                    <th className="py-3 px-3 text-right">Балл</th>
                    <th className="py-3 px-3 text-right">Пайыз</th>
                    <th className="py-3 px-3 text-right">Уақыт</th>
                    <th className="py-3 px-3 text-right">Ескерту (прокторинг)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.studentStats.map((st) => (
                    <tr key={st.studentId} className="print-avoid-break">
                      <td className="py-3 px-4 font-medium">
                        {st.displayName}
                        {st.studentCode && (
                          <span className="ml-2 text-xs font-mono text-slate-400">
                            {st.studentCode}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {st.earnedPoints} / {st.totalPointsPossible}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                        {st.percent}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                        {formatDurationMs(st.totalTimeMs)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums">
                        {st.violationCount > 0 ? (
                          <span className="text-amber-600 font-bold">{st.violationCount}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {detailTab === 'questions' && (
          <div className="space-y-4">
            {report.questionStats.map((qs) => {
              const qObj = detailSession.quizSnapshot.questions.find(
                (x) => x.id === qs.questionId
              );
              return (
                <div
                  key={qs.questionId}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 print-avoid-break"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      <span className="font-mono text-emerald-600 mr-1.5">#{qs.order + 1}</span>
                      <RichText text={qs.text} />
                    </div>
                    <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                      {qs.accuracyPercent}% дұрыс
                    </span>
                  </div>
                  <HorizontalBarChart
                    items={Object.entries(qs.optionDistribution).map(([k, count]) => {
                      const opt = qObj?.options?.find((o) => o.id === k);
                      return {
                        id: k,
                        label: opt ? `${k.toUpperCase()}) ${opt.text}` : k,
                        count,
                        highlight: qObj?.correct.includes(k),
                      };
                    })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // REPORTS LIST & STUDENT PROGRESS VIEW
  // =========================================================================
  const activeProgressStudent =
    progressList.find((s) => s.key === activeProgressKey) || progressList[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t('nav_reports')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Өткізілген сабақтардың есептері, экспорттар және оқушылар прогресі.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 self-start">
          <button
            type="button"
            onClick={() => setMode('sessions')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
              mode === 'sessions'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Сессиялар
          </button>
          <button
            type="button"
            onClick={() => setMode('progress')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
              mode === 'progress'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Оқушы прогресі
          </button>
        </div>
      </div>

      {mode === 'sessions' ? (
        <>
          {/* Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Сессия немесе бөлме бойынша іздеу…"
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="all">Барлық түрлер</option>
              <option value="quiz">Викторина</option>
              <option value="space_race">Space Race</option>
              <option value="quick_question">Жылдам сұрақ</option>
              <option value="exit_ticket">Шығу билеті</option>
              <option value="vote">Дауыс беру</option>
            </select>
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="all">Барлық бөлмелер</option>
              {uniqueRooms.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full h-10 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full h-10 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-slate-500">{t('loading')}</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">Есептер табылмады.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 text-left">
                      <th className="py-3 px-4">Атауы</th>
                      <th className="py-3 px-3">Бөлме</th>
                      <th className="py-3 px-3">Күні</th>
                      <th className="py-3 px-3 text-right">Оқушы</th>
                      <th className="py-3 px-3 text-right">Орташа</th>
                      <th className="py-3 px-4 text-right">Әрекет</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((s) => (
                      <tr
                        key={s.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-3 px-4 font-medium">
                          <button
                            type="button"
                            onClick={() =>
                              s.status !== 'ended' ? onOpenLive(s.id) : setSelectedId(s.id)
                            }
                            className="text-left hover:text-emerald-600"
                          >
                            {s.title}
                          </button>
                          <span className="ml-2 text-xs text-slate-400">· {s.kind}</span>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs">{s.roomName}</td>
                        <td className="py-3 px-3 text-xs text-slate-500 tabular-nums">
                          {formatDateShort(s.startedAt)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {s.studentCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                          {s.averagePercent}%
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              s.status !== 'ended' ? onOpenLive(s.id) : setSelectedId(s.id)
                            }
                            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            {s.status !== 'ended' ? 'Тірі басқару' : 'Ашу'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(s.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
                            title="Жою"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Student Progress Dynamics across all sessions */
        <div className="space-y-5">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={progressQuery}
              onChange={(e) => setProgressQuery(e.target.value)}
              placeholder="Оқушы аты немесе ID бойынша іздеу…"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          {progressList.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-500">
              Аяқталған сессияларда оқушы деректері әзірге жоқ.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {progressList.map((st) => (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setActiveProgressKey(st.key)}
                    className={`w-full text-left p-3.5 flex items-center justify-between text-sm ${
                      activeProgressStudent?.key === st.key
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 font-semibold text-emerald-800 dark:text-emerald-200'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="truncate">{st.displayName}</span>
                    <span className="font-mono text-xs text-slate-500 shrink-0">
                      {st.points.length} сабақ
                    </span>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
                {activeProgressStudent && (
                  <>
                    <div>
                      <h2 className="font-display font-bold text-lg">
                        {activeProgressStudent.displayName}
                      </h2>
                      <p className="text-xs text-slate-500">
                        Барлық сессиялар бойынша үлгерім динамикасы (%)
                      </p>
                    </div>
                    <ProgressLineChart
                      points={activeProgressStudent.points.map((p) => ({
                        label: p.title,
                        value: p.percent,
                      }))}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        title="Сессия есебін жою"
        message="Бұл сессияның барлық жауаптары мен есебі біржола жойылады."
        confirmLabel="Жою"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.deleteSession(deleteTarget);
          toast.success('Сессия жойылды');
          setDeleteTarget(null);
          await loadList();
        }}
      />
    </div>
  );
};
