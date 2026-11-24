import React, { useState } from 'react';
import { Download, KeyRound, Save, Trash2 } from 'lucide-react';
import type { Locale, PublicTeacher, SessionSettings } from '../../types.ts';
import { api, downloadAuthenticatedFile } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.ts';
import { Modal } from '../shared/Modal.tsx';
import { useToast } from '../shared/Toast.tsx';

export const Settings: React.FC<{
  teacher: PublicTeacher;
  onTeacherUpdated: (t: PublicTeacher) => void;
  onAccountDeleted: () => void;
}> = ({ teacher, onTeacherUpdated, onAccountDeleted }) => {
  const { t, setLocale } = useI18n();
  const toast = useToast();

  const [name, setName] = useState(teacher.name);
  const [email, setEmail] = useState(teacher.email);
  const [language, setLanguage] = useState<Locale>(teacher.language);
  const [defaults, setDefaults] = useState<SessionSettings>(teacher.defaultSessionSettings);
  const [saving, setSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { teacher: updated } = await api.updateProfile({
        name: name.trim(),
        email: email.trim(),
        language,
        defaultSessionSettings: defaults,
      });
      setLocale(language);
      onTeacherUpdated(updated);
      toast.success('Параметрлер сақталды');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwSaving(true);
    try {
      await api.changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      toast.success('Құпиясөз сәтті өзгертілді');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t('nav_settings')}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Профиль, әдепкі сабақ параметрлері, қауіпсіздік және деректер экспорты.
        </p>
      </div>

      {/* Profile & Default Session Settings */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5"
      >
        <h2 className="font-display font-bold text-base">Профиль және тіл</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Аты-жөні
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Интерфейс тілі
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Locale)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="kk">Қазақша</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Әдепкі қарқын (Pacing)
            </label>
            <select
              value={defaults.pacing}
              onChange={(e) =>
                setDefaults({ ...defaults, pacing: e.target.value as SessionSettings['pacing'] })
              }
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="student_paced_open">{t('pacing_open')}</option>
              <option value="student_paced_forward">{t('pacing_forward')}</option>
              <option value="teacher_paced">{t('pacing_teacher')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
          {(
            [
              ['requireNames', 'Аты-жөнін талап ету'],
              ['shuffleQuestions', 'Сұрақтарды араластыру'],
              ['shuffleAnswers', 'Нұсқаларды араластыру'],
              ['showFeedbackAfterEach', 'Әр сұрақтан кейін пікір көрсету'],
              ['showFinalScore', 'Қорытынды балл көрсету'],
              ['allowRetry', 'Қайта тапсыруға рұқсат'],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(defaults[field])}
                onChange={(e) => setDefaults({ ...defaults, [field]: e.target.checked })}
                className="accent-emerald-600"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? t('saving') : t('save')}
        </button>
      </form>

      {/* Change Password */}
      <form
        onSubmit={handleChangePassword}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4"
      >
        <h2 className="font-display font-bold text-base inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-emerald-600" />
          Құпиясөзді өзгерту
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input
            type="password"
            required
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Ағымдағы құпиясөз"
            className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Жаңа құпиясөз (кемінде 8 таңба)"
            className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pwSaving}
          className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold"
        >
          Құпиясөзді жаңарту
        </button>
      </form>

      {/* Data Export & Danger Zone */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-base">Деректерді экспорттау (JSON)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Барлық викториналарыңызды, қалталарды, бөлмелерді және есептерді жүктеп алыңыз.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            void downloadAuthenticatedFile('/api/auth/export-data', 'quizkz-my-data.json')
          }
          className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          JSON жүктеу
        </button>
      </div>

      <div className="bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-base text-red-700 dark:text-red-400">
            Аккаунтты жою
          </h2>
          <p className="text-xs text-red-600/80 dark:text-red-300/80 mt-0.5">
            Барлық викториналар, бөлмелер және есептер біржола өшіріледі.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
        >
          <Trash2 className="w-4 h-4" />
          Аккаунтты жою
        </button>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Аккаунтты біржола жою"
        subtitle="Растау үшін құпиясөзіңізді енгізіңіз"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.deleteAccount(deletePassword);
                  toast.success('Аккаунт жойылды');
                  onAccountDeleted();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold"
            >
              Біржола жою
            </button>
          </>
        }
      >
        <input
          type="password"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          placeholder="Құпиясөзіңіз"
          className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
        />
      </Modal>
    </div>
  );
};
