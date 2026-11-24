import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Play,
  Settings as SettingsIcon,
  Shield,
  X,
} from 'lucide-react';
import type { PublicTeacher, SessionKind } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.ts';
import { LanguageAndThemeControls } from '../shared/TopControls.tsx';
import { useToast } from '../shared/Toast.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Launch } from './Launch.tsx';
import { QuizLibrary } from './QuizLibrary.tsx';
import { QuizEditor } from './QuizEditor.tsx';
import { Rooms } from './Rooms.tsx';
import { LiveControl } from './LiveControl.tsx';
import { Reports } from './Reports.tsx';
import { Settings } from './Settings.tsx';
import { Admin } from './Admin.tsx';

export type TeacherTab =
  | 'dashboard'
  | 'launch'
  | 'quizzes'
  | 'editor'
  | 'rooms'
  | 'live'
  | 'reports'
  | 'settings'
  | 'admin';

export const TeacherShell: React.FC<{
  teacher: PublicTeacher;
  aiEnabled: boolean;
  onTeacherUpdated: (teacher: PublicTeacher) => void;
  onLogout: () => void;
}> = ({ teacher, aiEnabled, onTeacherUpdated, onLogout }) => {
  const { t } = useI18n();
  const toast = useToast();

  const [tab, setTab] = useState<TeacherTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Contextual sub-navigation state
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const [launchActivity, setLaunchActivity] = useState<SessionKind | null>(null);
  const [launchQuizId, setLaunchQuizId] = useState<string | null>(null);
  const [creatingQuiz, setCreatingQuiz] = useState(false);

  const navItems: {
    id: Exclude<TeacherTab, 'editor' | 'live'>;
    label: string;
    icon: React.FC<{ className?: string }>;
    adminOnly?: boolean;
  }[] = [
    { id: 'dashboard', label: t('nav_dashboard'), icon: LayoutDashboard },
    { id: 'launch', label: t('nav_launch'), icon: Play },
    { id: 'quizzes', label: t('nav_quizzes'), icon: BookOpen },
    { id: 'rooms', label: t('nav_rooms'), icon: DoorOpen },
    { id: 'reports', label: t('nav_reports'), icon: BarChart3 },
    { id: 'settings', label: t('nav_settings'), icon: SettingsIcon },
    { id: 'admin', label: t('nav_admin'), icon: Shield, adminOnly: true },
  ];

  const handleOpenTab = (next: Exclude<TeacherTab, 'editor' | 'live'>) => {
    setMobileMenuOpen(false);
    if (next === 'launch') {
      setLaunchActivity(null);
      setLaunchQuizId(null);
    }
    if (next === 'reports') {
      setReportSessionId(null);
    }
    setTab(next);
  };

  const handleOpenLaunchPreset = (preset?: SessionKind, quizId?: string) => {
    setLaunchActivity(preset ?? null);
    setLaunchQuizId(quizId ?? null);
    setTab('launch');
  };

  const handleCreateNewQuiz = async () => {
    if (creatingQuiz) return;
    setCreatingQuiz(true);
    try {
      const { quiz } = await api.createQuiz({
        title: 'Жаңа викторина',
        description: '',
        questions: [],
      });
      setEditingQuizId(quiz.id);
      setTab('editor');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreatingQuiz(false);
    }
  };

  const handleOpenLive = (sessionId: string) => {
    setLiveSessionId(sessionId);
    setTab('live');
  };

  const handleOpenReport = (sessionId: string) => {
    setReportSessionId(sessionId);
    setTab('reports');
  };

  const activeNavKey =
    tab === 'editor' ? 'quizzes' : tab === 'live' ? 'launch' : tab;

  const isLiveFullscreen = tab === 'live' && liveSessionId !== null;

  const renderSidebarNav = () => (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => handleOpenTab('dashboard')}
          className="flex items-center gap-2 text-left"
        >
          <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-display font-extrabold text-sm flex items-center justify-center shrink-0">
            QZ
          </span>
          <span className="font-display font-extrabold text-lg text-slate-900 dark:text-slate-100 whitespace-nowrap">
            QuizKZ <span className="text-emerald-600 dark:text-emerald-400">Live</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Мәзірді жабу"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Мұғалім навигациясы">
        {navItems
          .filter((item) => !item.adminOnly || teacher.role === 'admin')
          .map((item) => {
            const Icon = item.icon;
            const active = activeNavKey === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpenTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon
                  className={`w-4.5 h-4.5 shrink-0 ${
                    active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
        {teacher.persistentRoom && (
          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/70">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('my_room')}
            </div>
            <div className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400 tracking-wide mt-0.5">
              {teacher.persistentRoom.name}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {teacher.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {teacher.email}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title={t('logout')}
            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      {!isLiveFullscreen && (
        <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 no-print z-20">
          {renderSidebarNav()}
        </aside>
      )}

      {/* Mobile Drawer */}
      {mobileMenuOpen && !isLiveFullscreen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-xl z-50">
            {renderSidebarNav()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          !isLiveFullscreen ? 'lg:pl-60' : ''
        }`}
      >
        {!isLiveFullscreen && (
          <header className="sticky top-0 z-10 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 no-print">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Мәзірді ашу"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="lg:hidden font-display font-extrabold text-base text-slate-900 dark:text-slate-100 whitespace-nowrap">
                QuizKZ <span className="text-emerald-600 dark:text-emerald-400">Live</span>
              </span>
              {liveSessionId && (
                <button
                  type="button"
                  onClick={() => setTab('live')}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  <span>{t('active_session')}</span>
                  <span>→</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <LanguageAndThemeControls compact />
              <button
                type="button"
                onClick={onLogout}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('logout')}</span>
              </button>
            </div>
          </header>
        )}

        <main
          className={
            isLiveFullscreen
              ? 'flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto'
              : 'flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto'
          }
        >
          {tab === 'dashboard' && (
            <Dashboard
              teacher={teacher}
              onOpenLaunch={(preset) => handleOpenLaunchPreset(preset)}
              onNewQuiz={handleCreateNewQuiz}
              onOpenLive={handleOpenLive}
              onOpenReport={handleOpenReport}
            />
          )}

          {tab === 'launch' && (
            <Launch
              teacher={teacher}
              initialActivity={launchActivity}
              initialQuizId={launchQuizId}
              onSessionCreated={handleOpenLive}
            />
          )}

          {tab === 'quizzes' && (
            <QuizLibrary
              aiEnabled={aiEnabled}
              onEditQuiz={(quizId) => {
                setEditingQuizId(quizId);
                setTab('editor');
              }}
              onLaunchQuiz={(quizId) => handleOpenLaunchPreset('quiz', quizId)}
            />
          )}

          {tab === 'editor' && editingQuizId && (
            <QuizEditor
              quizId={editingQuizId}
              aiEnabled={aiEnabled}
              onBack={() => setTab('quizzes')}
              onLaunch={(quizId) => handleOpenLaunchPreset('quiz', quizId)}
            />
          )}

          {tab === 'rooms' && <Rooms onOpenLive={handleOpenLive} />}

          {tab === 'live' && liveSessionId && (
            <LiveControl
              sessionId={liveSessionId}
              onExit={() => setTab('dashboard')}
              onOpenReport={(sid) => {
                setLiveSessionId(null);
                handleOpenReport(sid);
              }}
              onReplaySession={(newSid) => {
                setLiveSessionId(newSid);
                setTab('live');
              }}
            />
          )}

          {tab === 'reports' && (
            <Reports
              aiEnabled={aiEnabled}
              initialSessionId={reportSessionId}
              onOpenLive={handleOpenLive}
            />
          )}

          {tab === 'settings' && (
            <Settings
              teacher={teacher}
              onTeacherUpdated={onTeacherUpdated}
              onAccountDeleted={onLogout}
            />
          )}

          {tab === 'admin' && teacher.role === 'admin' && <Admin />}
        </main>
      </div>
    </div>
  );
};
