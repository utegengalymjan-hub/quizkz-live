import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  Rocket,
  ShieldAlert,
  Ticket,
  Vote,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_SESSION_SETTINGS,
  type PublicTeacher,
  type QuestionType,
  type Quiz,
  type Room,
  type SessionKind,
  type SessionSettings,
  type SpaceRaceIcon,
} from '../../types.ts';
import { api } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.ts';
import { Modal } from '../shared/Modal.tsx';
import { VehicleSvg } from '../shared/Charts.tsx';
import { useToast } from '../shared/Toast.tsx';

export const Launch: React.FC<{
  teacher: PublicTeacher;
  initialActivity?: SessionKind | null;
  initialQuizId?: string | null;
  onSessionCreated: (sessionId: string) => void;
}> = ({ teacher, initialActivity = null, initialQuizId = null, onSessionCreated }) => {
  const { t } = useI18n();
  const toast = useToast();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeModal, setActiveModal] = useState<SessionKind | null>(initialActivity);
  const [submitting, setSubmitting] = useState(false);

  // Common launch fields
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedQuizId, setSelectedQuizId] = useState(initialQuizId || '');
  const [settings, setSettings] = useState<SessionSettings>(() => ({
    ...DEFAULT_SESSION_SETTINGS,
    ...teacher.defaultSessionSettings,
    proctoring: {
      ...DEFAULT_SESSION_SETTINGS.proctoring!,
      ...(teacher.defaultSessionSettings.proctoring || {}),
    },
  }));
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [startImmediately, setStartImmediately] = useState(false);

  // Quick Question fields
  const [qqType, setQqType] = useState<QuestionType>('multiple_choice');
  const [qqText, setQqText] = useState('');

  // Exit Ticket fields
  const [et1, setEt1] = useState('Бүгінгі сабақты қаншалықты түсіндің?');
  const [et2, setEt2] = useState('Бүгін не үйрендің?');
  const [et3, setEt3] = useState('Сабақ бойынша бір мысал келтір немесе сұрағыңды жаз:');

  // Vote fields
  const [votePrompt, setVotePrompt] = useState('Бүгінгі тақырып бойынша ең маңызды идея қандай?');

  useEffect(() => {
    Promise.all([api.getQuizzes(false), api.getRooms()])
      .then(([qRes, rRes]) => {
        setQuizzes(qRes.quizzes);
        setRooms(rRes.rooms);
        const persist = rRes.rooms.find((r) => r.isPersistent) || rRes.rooms[0];
        if (persist) setSelectedRoomId(persist.id);
        if (!initialQuizId && qRes.quizzes[0]) setSelectedQuizId(qRes.quizzes[0].id);
      })
      .catch((err) => toast.error((err as Error).message));
  }, [initialQuizId, toast]);

  useEffect(() => {
    if (initialActivity) setActiveModal(initialActivity);
    if (initialQuizId) setSelectedQuizId(initialQuizId);
  }, [initialActivity, initialQuizId]);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModal) return;
    if ((activeModal === 'quiz' || activeModal === 'space_race') && !selectedQuizId) {
      toast.error('Алдымен викторинаны таңдаңыз.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind: activeModal,
        roomId: selectedRoomId,
        settings,
        saveAsDefault,
        startImmediately:
          activeModal === 'quick_question' || activeModal === 'exit_ticket'
            ? true
            : startImmediately,
      };
      if (activeModal === 'quiz' || activeModal === 'space_race') {
        payload.quizId = selectedQuizId;
      } else if (activeModal === 'quick_question') {
        payload.questionType = qqType;
        payload.questionText = qqText.trim() || 'Жылдам сұрақ №1';
      } else if (activeModal === 'exit_ticket') {
        payload.q1 = et1;
        payload.q2 = et2;
        payload.q3 = et3;
      } else if (activeModal === 'vote') {
        payload.votePrompt = votePrompt;
      }

      const { session } = await api.createSession(payload);
      toast.success(`Сессия «${session.roomName}» бөлмесінде ашылды`);
      setActiveModal(null);
      onSessionCreated(session.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cards: {
    kind: SessionKind;
    title: string;
    desc: string;
    icon: React.ReactNode;
  }[] = [
    {
      kind: 'quiz',
      title: t('act_quiz'),
      desc: t('act_quiz_desc'),
      icon: <ClipboardList className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      kind: 'space_race',
      title: t('act_space_race'),
      desc: t('act_space_race_desc'),
      icon: <Rocket className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      kind: 'quick_question',
      title: t('act_quick_question'),
      desc: t('act_quick_question_desc'),
      icon: <Zap className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      kind: 'exit_ticket',
      title: t('act_exit_ticket'),
      desc: t('act_exit_ticket_desc'),
      icon: <Ticket className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      kind: 'vote',
      title: t('act_vote'),
      desc: t('act_vote_desc'),
      icon: <Vote className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
    },
  ];

  const icons: { id: SpaceRaceIcon; label: string }[] = [
    { id: 'rocket', label: 'Зымыран' },
    { id: 'bicycle', label: 'Велосипед' },
    { id: 'bee', label: 'Ара' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t('nav_launch')}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Сабақ белсенділігін таңдаңыз — бөлмедегі барлық оқушылар бірден қосыла алады.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => setActiveModal(c.kind)}
            className="group p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-500 text-left flex flex-col justify-between gap-4 transition-all"
          >
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
                {c.icon}
              </div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                {c.title}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{c.desc}</p>
            </div>
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 group-hover:underline">
              Баптау және іске қосу →
            </span>
          </button>
        ))}
      </div>

      {/* Launch Configuration Modal */}
      <Modal
        open={Boolean(activeModal)}
        onClose={() => setActiveModal(null)}
        title={
          activeModal === 'quiz'
            ? 'Викторинаны іске қосу'
            : activeModal === 'space_race'
            ? 'Space Race командалық жарысы'
            : activeModal === 'quick_question'
            ? 'Жылдам сұрақ қою'
            : activeModal === 'exit_ticket'
            ? 'Шығу билеті (Exit Ticket)'
            : 'Дауыс беру (Vote)'
        }
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="launch-session-form"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold"
            >
              {submitting ? t('loading') : t('start')}
            </button>
          </>
        }
      >
        <form id="launch-session-form" onSubmit={handleLaunch} className="space-y-5">
          {/* Room Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Бөлмені таңдау
              </label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.isPersistent ? '(Тұрақты)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {(activeModal === 'quiz' || activeModal === 'space_race') && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Викторинаны таңдау
                </label>
                <select
                  value={selectedQuizId}
                  onChange={(e) => setSelectedQuizId(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                >
                  {quizzes.length === 0 && <option value="">Викториналар жоқ</option>}
                  {quizzes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title} ({q.questions.length} сұрақ)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quiz Specific Settings */}
          {activeModal === 'quiz' && (
            <>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Қарқын (Pacing)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      { id: 'student_paced_open', label: t('pacing_open') },
                      { id: 'student_paced_forward', label: t('pacing_forward') },
                      { id: 'teacher_paced', label: t('pacing_teacher') },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSettings({ ...settings, pacing: p.id })}
                      className={`p-3 rounded-xl border text-left text-xs sm:text-sm font-medium transition-colors ${
                        settings.pacing === p.id
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ['requireNames', 'Аты-жөнін талап ету'],
                    ['requireStudentCode', 'Оқушы ID-ін сұрау'],
                    ['shuffleQuestions', 'Сұрақтарды араластыру'],
                    ['shuffleAnswers', 'Жауап нұсқаларын араластыру'],
                    ['showFeedbackAfterEach', 'Әр сұрақтан кейін дұрыс/қате көрсету'],
                    ['showFinalScore', 'Соңында қорытынды балл көрсету'],
                    ['allowRetry', 'Қайта тапсыруға рұқсат беру'],
                  ] as const
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(settings[field])}
                      onChange={(e) => setSettings({ ...settings, [field]: e.target.checked })}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <span className="text-slate-800 dark:text-slate-200">{label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Жалпы таймер (минут, 0 = жоқ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={Math.round((settings.timeLimitSeconds || 0) / 60)}
                    onChange={(e) => {
                      const mins = Math.max(0, Number(e.target.value) || 0);
                      setSettings({
                        ...settings,
                        timeLimitSeconds: mins > 0 ? mins * 60 : undefined,
                      });
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Әр сұраққа таймер (сек, 0 = жоқ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={settings.perQuestionSeconds || 0}
                    onChange={(e) => {
                      const sec = Math.max(0, Number(e.target.value) || 0);
                      setSettings({
                        ...settings,
                        perQuestionSeconds: sec > 0 ? sec : undefined,
                      });
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Көп дұрыс жауап балдауы
                  </label>
                  <select
                    value={settings.multiCorrectMode || 'all_or_nothing'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        multiCorrectMode: e.target.value as 'all_or_nothing' | 'partial',
                      })
                    }
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    <option value="all_or_nothing">Барлығы дұрыс болуы керек</option>
                    <option value="partial">Жартылай балл беру</option>
                  </select>
                </div>
              </div>

              {/* Proctoring Section */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/70 dark:bg-slate-950/50">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="inline-flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Прокторинг (емтихан режимін қосу)
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.proctoring?.enabled)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        proctoring: { ...settings.proctoring!, enabled: e.target.checked },
                      })
                    }
                    className="w-4 h-4 accent-emerald-600"
                  />
                </label>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('proctoring_disclaimer')}
                </p>

                {settings.proctoring?.enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.proctoring.requireFullscreen}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proctoring: {
                              ...settings.proctoring!,
                              requireFullscreen: e.target.checked,
                            },
                          })
                        }
                        className="accent-emerald-600"
                      />
                      Толық экран талап ету
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.proctoring.detectTabSwitch}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proctoring: {
                              ...settings.proctoring!,
                              detectTabSwitch: e.target.checked,
                            },
                          })
                        }
                        className="accent-emerald-600"
                      />
                      Қойынды/терезе ауысуын тіркеу
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.proctoring.blockCopyPaste}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proctoring: {
                              ...settings.proctoring!,
                              blockCopyPaste: e.target.checked,
                            },
                          })
                        }
                        className="accent-emerald-600"
                      />
                      Көшіру/қою/оң шертуді блоктау
                    </label>
                    <div className="flex items-center gap-2">
                      <span>Лимит (0 = шексіз):</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={settings.proctoring.maxViolations}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proctoring: {
                              ...settings.proctoring!,
                              maxViolations: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                            },
                          })
                        }
                        className="w-16 h-8 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center gap-3">
                      <span>Лимит толғанда:</span>
                      <select
                        value={settings.proctoring.actionOnLimit}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proctoring: {
                              ...settings.proctoring!,
                              actionOnLimit: e.target.value as 'log_only' | 'auto_submit',
                            },
                          })
                        }
                        className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm"
                      >
                        <option value="log_only">Тек журналға жазу</option>
                        <option value="auto_submit">Жұмысты автоматты жабу</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={startImmediately}
                    onChange={(e) => setStartImmediately(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  Лоббисіз бірден бастау
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsDefault}
                    onChange={(e) => setSaveAsDefault(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  Осы параметрлерді әдепкі ретінде сақтау
                </label>
              </div>
            </>
          )}

          {/* Space Race Settings */}
          {activeModal === 'space_race' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Командалар саны (2–10)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={settings.spaceRaceTeamCount || 4}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        spaceRaceTeamCount: Math.max(2, Math.min(10, Number(e.target.value) || 4)),
                      })
                    }
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Командаға бөлу
                  </label>
                  <select
                    value={settings.spaceRaceAssignment || 'auto'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        spaceRaceAssignment: e.target.value as 'auto' | 'student_choice' | 'manual',
                      })
                    }
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    <option value="auto">Кездейсоқ (теңдей автоматты)</option>
                    <option value="student_choice">Оқушы өзі таңдайды</option>
                    <option value="manual">Мұғалім лоббиде қолмен бөледі</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Жарыс белгісі (Проектор көрінісі)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {icons.map((ic) => (
                    <button
                      key={ic.id}
                      type="button"
                      onClick={() => setSettings({ ...settings, spaceRaceIcon: ic.id })}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-colors ${
                        (settings.spaceRaceIcon || 'rocket') === ic.id
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <VehicleSvg icon={ic.id} color="#059669" size={40} />
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {ic.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick Question Settings */}
          {activeModal === 'quick_question' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    ['multiple_choice', 'A / B / C / D'],
                    ['true_false', 'Дұрыс / Қате'],
                    ['short_answer', 'Қысқа жауап'],
                  ] as const
                ).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setQqType(type)}
                    className={`p-3 rounded-xl border text-sm font-semibold ${
                      qqType === type
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Сұрақ мәтіні (міндетті емес — ауызша сұрақ болса бос қалдыруға болады)
                </label>
                <textarea
                  rows={2}
                  value={qqText}
                  onChange={(e) => setQqText(e.target.value)}
                  placeholder="Мысалы: Тақтадағы теңдеудің дұрыс нұсқасын таңдаңыз"
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
            </div>
          )}

          {/* Exit Ticket Settings */}
          {activeModal === 'exit_ticket' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  1-сұрақ (Түсіну шкаласы)
                </label>
                <input
                  type="text"
                  value={et1}
                  onChange={(e) => setEt1(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  2-сұрақ (Мәтін)
                </label>
                <input
                  type="text"
                  value={et2}
                  onChange={(e) => setEt2(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  3-сұрақ (Мұғалім сұрағы / есеп)
                </label>
                <input
                  type="text"
                  value={et3}
                  onChange={(e) => setEt3(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
            </div>
          )}

          {/* Vote Settings */}
          {activeModal === 'vote' && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Дауыс беру сұрағы (оқушылар қысқа жауап жазады)
              </label>
              <textarea
                rows={3}
                required
                value={votePrompt}
                onChange={(e) => setVotePrompt(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
};
