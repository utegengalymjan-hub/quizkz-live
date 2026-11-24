import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import type { PublicTeacher, Question } from '../../types.ts';
import { api, setTeacherToken } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.ts';
import { LanguageAndThemeControls } from '../shared/TopControls.tsx';
import { RichText } from '../shared/RichText.tsx';

export const AuthView: React.FC<{
  initialMode?: 'login' | 'register' | 'reset';
  resetToken?: string;
  onAuthenticated: (teacher: PublicTeacher) => void;
  onBackToStudent: () => void;
}> = ({ initialMode = 'login', resetToken = '', onAuthenticated, onBackToStudent }) => {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'reset') {
        await api.resetPasswordWithToken(resetToken, password);
        setResetDone(true);
        return;
      }
      if (mode === 'register') {
        const res = await api.register({ name: name.trim(), email: email.trim(), password, language: locale });
        setTeacherToken(res.token);
        onAuthenticated(res.teacher);
      } else {
        const res = await api.login({ email: email.trim(), password });
        setTeacherToken(res.token);
        onAuthenticated(res.teacher);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBackToStudent}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('student_join')}</span>
          </button>
          <span className="font-display font-extrabold text-lg text-slate-900 dark:text-slate-100">
            QuizKZ <span className="text-emerald-600 dark:text-emerald-400">Live</span>
          </span>
          <LanguageAndThemeControls compact />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          {mode === 'reset' ? (
            resetDone ? (
              <div className="text-center space-y-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                  Құпиясөз сәтті жаңартылды
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setPassword('');
                  }}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  Кіру бетіне өту
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <KeyRound className="w-6 h-6 text-emerald-600" />
                  <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                    Жаңа құпиясөз орнату
                  </h1>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('password_label')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-600"
                  />
                </div>
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  {loading ? t('loading') : 'Құпиясөзді сақтау'}
                </button>
              </form>
            )
          ) : (
            <>
              <div className="space-y-1">
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {mode === 'login' ? t('login_title') : t('register_title')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {mode === 'register'
                    ? 'Тіркелген кезде тұрақты бөлмеңіз және 8 сұрақтық үлгі викторина автоматты құрылады.'
                    : 'Викториналарды, бөлмелерді және сабақ есептерін басқару үшін кіріңіз.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('name_label')}
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Мысалы: Әсел Нұрланова"
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-600"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('email_label')}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teacher@school.kz"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('password_label')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-600"
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
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : mode === 'login' ? (
                    <>
                      <LogIn className="w-4 h-4" />
                      {t('login_btn')}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      {t('register_btn')}
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-sm text-slate-600 dark:text-slate-400">
                {mode === 'login' ? (
                  <>
                    {t('no_account')}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setError('');
                      }}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      {t('register_btn')}
                    </button>
                  </>
                ) : (
                  <>
                    {t('has_account')}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError('');
                      }}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      {t('login_btn')}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export const PublicShareQuizView: React.FC<{
  code: string;
  onBack: () => void;
  onGoLogin: () => void;
}> = ({ code, onBack, onGoLogin }) => {
  const [quiz, setQuiz] = useState<{
    title: string;
    description?: string;
    shareCode: string;
    questions: Question[];
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getPublicQuiz(code)
      .then((res) => setQuiz(res.quiz))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" /> Басты бет
          </button>
          <span className="font-display font-bold text-slate-900 dark:text-slate-100">
            QuizKZ Live
          </span>
          <button
            type="button"
            onClick={onGoLogin}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
          >
            Кітапханама импорттау
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        {loading ? (
          <div className="py-16 text-center text-slate-500">Жүктелуде…</div>
        ) : error || !quiz ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2">
            <p className="text-red-600 font-medium">{error || 'Викторина табылмады.'}</p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-2">
              <div className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                Бөлісу коды: {quiz.shareCode} · {quiz.questions.length} сұрақ
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
                {quiz.title}
              </h1>
              {quiz.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400">{quiz.description}</p>
              )}
            </div>

            <div className="space-y-3">
              {quiz.questions.map((q, idx) => (
                <div
                  key={q.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
                >
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    <span className="font-mono text-slate-400 mr-2">{idx + 1}.</span>
                    <RichText text={q.text} />
                  </div>
                  {q.imageUrl && (
                    <img
                      src={q.imageUrl}
                      alt="Сұрақ суреті"
                      className="max-h-56 rounded-lg border border-slate-200"
                    />
                  )}
                  {q.options && (
                    <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300 pl-4">
                      {q.options.map((o) => (
                        <li key={o.id}>
                          <span className="font-mono font-semibold mr-1.5">
                            {o.id.toUpperCase()})
                          </span>
                          <RichText text={o.text} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
