import React, { useEffect, useState } from 'react';
import { Ban, CheckCircle, Download, KeyRound, Shield } from 'lucide-react';
import { api, downloadAuthenticatedFile } from '../../lib/api.ts';
import { copyToClipboard, formatBytes, formatDateShort } from '../../lib/utils.ts';
import { useToast } from '../shared/Toast.tsx';

export const Admin: React.FC = () => {
  const toast = useToast();
  const [teachers, setTeachers] = useState<
    {
      id: string;
      name: string;
      email: string;
      role: 'admin' | 'teacher';
      blocked: boolean;
      createdAt: string;
      lastLoginAt?: string;
      quizCount: number;
      sessionCount: number;
      roomName: string;
    }[]
  >([]);
  const [stats, setStats] = useState<{
    fileSizeBytes: number;
    backupCount: number;
    teacherCount: number;
    quizCount: number;
    sessionCount: number;
    activeSessionCount: number;
    todaySessionCount: number;
    activeStudentsCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [tRes, sRes] = await Promise.all([api.adminTeachers(), api.adminStats()]);
      setTeachers(tRes.teachers);
      setStats(sRes);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Shield className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
              Әкімші панелі
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Мұғалімдерді басқару, жүйе статистикасы және деректер қорының резервтік көшірмесі.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            void downloadAuthenticatedFile('/api/admin/backup', 'quizkz-full-backup.json')
          }
          className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap self-start"
        >
          <Download className="w-4 h-4" />
          JSON резервтік көшірме
        </button>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            ['Мұғалімдер', stats.teacherCount],
            ['Викториналар', stats.quizCount],
            ['Бүгінгі сабақ', stats.todaySessionCount],
            ['Белсенді оқушы', stats.activeStudentsCount],
            ['Дерек көлемі', formatBytes(stats.fileSizeBytes)],
            ['Бэкап саны', stats.backupCount],
          ].map(([label, val]) => (
            <div
              key={String(label)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"
            >
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                {val}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Teachers Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Жүктелуде…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 text-left">
                  <th className="py-3 px-4">Мұғалім</th>
                  <th className="py-3 px-3">Бөлме</th>
                  <th className="py-3 px-3 text-right">Викторина</th>
                  <th className="py-3 px-3 text-right">Сессия</th>
                  <th className="py-3 px-3">Соңғы кіру</th>
                  <th className="py-3 px-4 text-right">Әрекет</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {teachers.map((tc) => (
                  <tr key={tc.id}>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {tc.name}
                        {tc.role === 'admin' && (
                          <span className="ml-2 text-xs text-emerald-600 font-semibold">
                            · Әкімші
                          </span>
                        )}
                        {tc.blocked && (
                          <span className="ml-2 text-xs text-red-600 font-semibold">
                            · Блокталған
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{tc.email}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs">{tc.roomName}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{tc.quizCount}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {tc.sessionCount}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-500 tabular-nums">
                      {formatDateShort(tc.lastLoginAt || tc.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const { resetUrl } = await api.adminResetLink(tc.id);
                          await copyToClipboard(resetUrl);
                          toast.success('Құпиясөзді қайта орнату сілтемесі көшірілді');
                        }}
                        title="Құпиясөзді қайта орнату сілтемесін жасау"
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Сілтеме
                      </button>
                      {tc.role !== 'admin' &&
                        (tc.blocked ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.adminUnblockTeacher(tc.id);
                              toast.success('Мұғалім қалпына келтірілді');
                              await load();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Ашу
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.adminBlockTeacher(tc.id);
                              toast.success('Мұғалім блокталды');
                              await load();
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Блоктау
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
