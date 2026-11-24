import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  GripVertical,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { Folder, Question, QuestionType, Quiz } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { readImageFileAsDataUrl } from '../../lib/utils.ts';
import { useI18n } from '../../lib/i18n.ts';
import { RichText } from '../shared/RichText.tsx';
import { Modal } from '../shared/Modal.tsx';
import { useToast } from '../shared/Toast.tsx';

function makeClientId(prefix = 'q') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyQuestion(type: QuestionType, order: number): Question {
  if (type === 'true_false') {
    return {
      id: makeClientId('q'),
      type: 'true_false',
      text: '',
      options: [
        { id: 'true', text: 'Дұрыс' },
        { id: 'false', text: 'Қате' },
      ],
      correct: ['true'],
      points: 1,
      order,
    };
  }
  if (type === 'short_answer') {
    return {
      id: makeClientId('q'),
      type: 'short_answer',
      text: '',
      correct: [],
      points: 1,
      caseSensitive: false,
      ignoreSpacesAndDashes: true,
      order,
    };
  }
  return {
    id: makeClientId('q'),
    type: 'multiple_choice',
    text: '',
    options: [
      { id: 'a', text: '' },
      { id: 'b', text: '' },
      { id: 'c', text: '' },
      { id: 'd', text: '' },
    ],
    correct: ['a'],
    multiCorrectMode: 'all_or_nothing',
    points: 1,
    order,
  };
}

export const QuizEditor: React.FC<{
  quizId: string;
  aiEnabled: boolean;
  onBack: () => void;
  onLaunch: (quizId: string) => void;
}> = ({ quizId, aiEnabled, onBack, onLaunch }) => {
  const { t, locale } = useI18n();
  const toast = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');

  // Undo / Redo stacks
  const [past, setPast] = useState<Quiz[]>([]);
  const [future, setFuture] = useState<Quiz[]>([]);

  // Preview modal
  const [previewOpen, setPreviewOpen] = useState(false);

  // Dragging index
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // AI Generate modal
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiGrade, setAiGrade] = useState('7-сынып');
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Question[]>([]);

  // AI Per-question refinement suggestion
  const [refineSuggestion, setRefineSuggestion] = useState<{
    questionId: string;
    suggestion: Partial<Question>;
  } | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([api.getQuiz(quizId), api.getFolders()])
      .then(([qRes, fRes]) => {
        setQuiz(qRes.quiz);
        setFolders(fRes.folders);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setLoading(false));
  }, [quizId, toast]);

  const commitChange = (updater: (prev: Quiz) => Quiz, recordHistory = true) => {
    setQuiz((prev) => {
      if (!prev) return prev;
      if (recordHistory) {
        setPast((p) => [...p.slice(-24), structuredClone(prev)]);
        setFuture([]);
      }
      const next = updater(structuredClone(prev));
      next.questions = next.questions.map((q, i) => ({ ...q, order: i }));
      setSaveState('dirty');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        void persistQuiz(next);
      }, 1000);
      return next;
    });
  };

  const persistQuiz = async (target?: Quiz) => {
    const q = target || quiz;
    if (!q) return;
    setSaveState('saving');
    try {
      await api.updateQuiz(q.id, {
        title: q.title,
        description: q.description,
        folderId: q.folderId,
        questions: q.questions,
      });
      setSaveState('saved');
    } catch (err) {
      setSaveState('dirty');
      toast.error((err as Error).message);
    }
  };

  const handleUndo = () => {
    if (!quiz || past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [structuredClone(quiz), ...f.slice(0, 24)]);
    setQuiz(prev);
    setSaveState('dirty');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => void persistQuiz(prev), 1000);
  };

  const handleRedo = () => {
    if (!quiz || future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p.slice(-24), structuredClone(quiz)]);
    setQuiz(next);
    setSaveState('dirty');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => void persistQuiz(next), 1000);
  };

  // Validation warnings
  const validationIssues = useMemo(() => {
    if (!quiz) return [];
    const issues: string[] = [];
    quiz.questions.forEach((q, i) => {
      if (!q.text.trim()) issues.push(`${i + 1}-сұрақтың мәтіні бос.`);
      if (q.type === 'multiple_choice') {
        if (!q.options || q.options.length < 2) {
          issues.push(`${i + 1}-сұрақта кемінде 2 нұсқа болуы керек.`);
        }
        if (q.correct.length === 0) {
          issues.push(`${i + 1}-сұрақта дұрыс жауап белгіленбеген.`);
        }
      }
      if (q.type === 'true_false' && q.correct.length === 0) {
        issues.push(`${i + 1}-сұрақта Дұрыс/Қате таңдалмаған.`);
      }
    });
    return issues;
  }, [quiz]);

  const handleImageUpload = async (qIdx: number, file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      commitChange((prev) => {
        prev.questions[qIdx].imageUrl = dataUrl;
        return prev;
      });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handlePasteImage = async (qIdx: number, e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await handleImageUpload(qIdx, file);
        }
        break;
      }
    }
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim()) return;
    setAiLoading(true);
    try {
      const { questions } = await api.aiGenerateQuestions({
        topic: aiTopic.trim(),
        grade: aiGrade.trim(),
        count: aiCount,
        difficulty: aiDifficulty,
        language: locale,
      });
      setAiSuggestions(questions);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiRefine = async (
    q: Question,
    action: 'harder' | 'easier' | 'add_options' | 'write_explanation'
  ) => {
    setRefiningId(q.id);
    try {
      const { suggestion } = await api.aiRefineQuestion({
        question: q,
        action,
        language: locale,
      });
      setRefineSuggestion({ questionId: q.id, suggestion });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefiningId(null);
    }
  };

  if (loading || !quiz) {
    return <div className="py-16 text-center text-slate-500">{t('loading')}</div>;
  }

  const letters = ['a', 'b', 'c', 'd', 'e', 'f'];

  return (
    <div className="space-y-6 pb-16">
      {/* Sticky Top Editor Bar */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900"
            aria-label="Артқа"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {saveState === 'saving'
              ? t('saving')
              : saveState === 'saved'
              ? `✓ ${t('saved')}`
              : 'Өзгерістер бар…'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={past.length === 0}
            onClick={handleUndo}
            title="Қайтару (Undo)"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-35 hover:bg-white dark:hover:bg-slate-900"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={future.length === 0}
            onClick={handleRedo}
            title="Қайта жасау (Redo)"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-35 hover:bg-white dark:hover:bg-slate-900"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            Алдын ала қарау
          </button>
          <button
            type="button"
            disabled={!aiEnabled}
            title={!aiEnabled ? t('ai_disabled_notice') : 'AI сұрақ генерациясы'}
            onClick={() => setAiGenOpen(true)}
            className="h-9 px-3 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 disabled:opacity-45 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            AI генерация
          </button>
          <button
            type="button"
            onClick={() => void persistQuiz()}
            className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            {t('save')}
          </button>
          <button
            type="button"
            onClick={async () => {
              await persistQuiz();
              onLaunch(quiz.id);
            }}
            className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Play className="w-4 h-4" />
            Іске қосу
          </button>
        </div>
      </div>

      {/* Quiz Metadata */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8 space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Викторина атауы
            </label>
            <input
              type="text"
              value={quiz.title}
              onChange={(e) =>
                commitChange((prev) => {
                  prev.title = e.target.value;
                  return prev;
                })
              }
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-display text-lg font-bold"
            />
          </div>
          <div className="md:col-span-4 space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Қалта
            </label>
            <select
              value={quiz.folderId || ''}
              onChange={(e) =>
                commitChange((prev) => {
                  prev.folderId = e.target.value || null;
                  return prev;
                })
              }
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="">Қалтасыз</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Сипаттама (міндетті емес)
          </label>
          <input
            type="text"
            value={quiz.description || ''}
            onChange={(e) =>
              commitChange((prev) => {
                prev.description = e.target.value;
                return prev;
              })
            }
            placeholder="Тақырып, сынып немесе ескертпе…"
            className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
          />
        </div>
      </div>

      {/* Validation Banner */}
      {validationIssues.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs sm:text-sm text-amber-800 dark:text-amber-300 space-y-1">
          <div className="font-semibold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Тексеру ескертулері ({validationIssues.length}):
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {validationIssues.slice(0, 5).map((iss, idx) => (
              <li key={idx}>{iss}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-4">
        {quiz.questions.map((q, qIdx) => (
          <div
            key={q.id}
            draggable
            onDragStart={() => setDragIdx(qIdx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx === null || dragIdx === qIdx) return;
              commitChange((prev) => {
                const [moved] = prev.questions.splice(dragIdx, 1);
                prev.questions.splice(qIdx, 0, moved);
                return prev;
              });
              setDragIdx(null);
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4"
          >
            {/* Question Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-slate-400 cursor-grab" />
                <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                  #{qIdx + 1}
                </span>
                <select
                  value={q.type}
                  onChange={(e) => {
                    const nextType = e.target.value as QuestionType;
                    commitChange((prev) => {
                      const cur = prev.questions[qIdx];
                      const fresh = createEmptyQuestion(nextType, qIdx);
                      prev.questions[qIdx] = {
                        ...fresh,
                        id: cur.id,
                        text: cur.text,
                        imageUrl: cur.imageUrl,
                        points: cur.points,
                        explanation: cur.explanation,
                      };
                      return prev;
                    });
                  }}
                  className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
                >
                  <option value="multiple_choice">{t('qt_multiple_choice')}</option>
                  <option value="true_false">{t('qt_true_false')}</option>
                  <option value="short_answer">{t('qt_short_answer')}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="inline-flex items-center gap-1 text-xs text-slate-500">
                  Ұпай:
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={q.points}
                    onChange={(e) =>
                      commitChange((prev) => {
                        prev.questions[qIdx].points = Math.max(0, Number(e.target.value) || 0);
                        return prev;
                      })
                    }
                    className="w-14 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-slate-500">
                  Таймер (с):
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={q.timeLimitSeconds || 0}
                    onChange={(e) =>
                      commitChange((prev) => {
                        const s = Math.max(0, Number(e.target.value) || 0);
                        prev.questions[qIdx].timeLimitSeconds = s > 0 ? s : undefined;
                        return prev;
                      })
                    }
                    className="w-16 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </label>

                <button
                  type="button"
                  disabled={qIdx === 0}
                  onClick={() =>
                    commitChange((prev) => {
                      const [m] = prev.questions.splice(qIdx, 1);
                      prev.questions.splice(qIdx - 1, 0, m);
                      return prev;
                    })
                  }
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Жоғары"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={qIdx === quiz.questions.length - 1}
                  onClick={() =>
                    commitChange((prev) => {
                      const [m] = prev.questions.splice(qIdx, 1);
                      prev.questions.splice(qIdx + 1, 0, m);
                      return prev;
                    })
                  }
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Төмен"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commitChange((prev) => {
                      const clone = { ...structuredClone(q), id: makeClientId('q') };
                      prev.questions.splice(qIdx + 1, 0, clone);
                      return prev;
                    })
                  }
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Көшіру"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commitChange((prev) => {
                      prev.questions.splice(qIdx, 1);
                      return prev;
                    })
                  }
                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  title="Жою"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Formatting Toolbar + Textarea */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(
                  [
                    ['**қалың**', 'Қалың'],
                    ['*көлбеу*', 'Көлбеу'],
                    ['\n- тізім', 'Тізім'],
                    ['$x^2 + y^2 = r^2$', 'KaTeX ($)'],
                    ['$$\\frac{a}{b}$$', 'Формула ($$)'],
                  ] as const
                ).map(([snippet, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      commitChange((prev) => {
                        prev.questions[qIdx].text = `${prev.questions[qIdx].text} ${snippet}`.trim();
                        return prev;
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {label}
                  </button>
                ))}

                <label className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" />
                  Сурет (≤2МБ)
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleImageUpload(qIdx, e.target.files?.[0])}
                  />
                </label>
              </div>

              <textarea
                rows={2}
                value={q.text}
                onPaste={(e) => void handlePasteImage(qIdx, e)}
                onChange={(e) =>
                  commitChange((prev) => {
                    prev.questions[qIdx].text = e.target.value;
                    return prev;
                  })
                }
                placeholder="Сұрақ мәтінін жазыңыз… (формула үшін $...$, суретті Ctrl+V арқылы қоюға болады)"
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:border-emerald-600 outline-none"
              />

              {(q.text.includes('$') || q.text.includes('**') || q.text.includes('*')) && (
                <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm">
                  <span className="text-[11px] text-slate-400 mr-2">Көрінісі:</span>
                  <RichText text={q.text} />
                </div>
              )}

              {q.imageUrl && (
                <div className="relative inline-block">
                  <img
                    src={q.imageUrl}
                    alt="Сұрақ суреті"
                    className="max-h-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      commitChange((prev) => {
                        prev.questions[qIdx].imageUrl = undefined;
                        return prev;
                      })
                    }
                    className="absolute top-2 right-2 p-1 rounded-full bg-slate-900/80 text-white"
                    aria-label="Суретті алып тастау"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Answer Editor by Question Type */}
            {q.type === 'multiple_choice' && q.options && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Дұрыс жауап(тар)ды белгілеңіз (2–6 нұсқа):</span>
                  {q.correct.length > 1 && (
                    <select
                      value={q.multiCorrectMode || 'all_or_nothing'}
                      onChange={(e) =>
                        commitChange((prev) => {
                          prev.questions[qIdx].multiCorrectMode = e.target.value as
                            | 'all_or_nothing'
                            | 'partial';
                          return prev;
                        })
                      }
                      className="h-7 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    >
                      <option value="all_or_nothing">Толық сәйкестік</option>
                      <option value="partial">Жартылай балл</option>
                    </select>
                  )}
                </div>

                {q.options.map((opt, oi) => {
                  const isCorr = q.correct.includes(opt.id);
                  return (
                    <div key={opt.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          commitChange((prev) => {
                            const cur = prev.questions[qIdx];
                            cur.correct = cur.correct.includes(opt.id)
                              ? cur.correct.filter((c) => c !== opt.id)
                              : [...cur.correct, opt.id];
                            return prev;
                          })
                        }
                        className={`w-8 h-8 rounded-lg border font-mono text-xs font-bold flex items-center justify-center shrink-0 transition-colors ${
                          isCorr
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500'
                        }`}
                        title="Дұрыс жауап ретінде белгілеу"
                      >
                        {isCorr ? <Check className="w-4 h-4" /> : opt.id.toUpperCase()}
                      </button>
                      <input
                        type="text"
                        value={opt.text}
                        onChange={(e) =>
                          commitChange((prev) => {
                            prev.questions[qIdx].options![oi].text = e.target.value;
                            return prev;
                          })
                        }
                        placeholder={`Нұсқа ${opt.id.toUpperCase()}`}
                        className="flex-1 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                      />
                      {q.options!.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            commitChange((prev) => {
                              const cur = prev.questions[qIdx];
                              const removedId = cur.options![oi].id;
                              cur.options!.splice(oi, 1);
                              cur.correct = cur.correct.filter((c) => c !== removedId);
                              return prev;
                            })
                          }
                          className="p-2 text-slate-400 hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}

                {q.options.length < 6 && (
                  <button
                    type="button"
                    onClick={() =>
                      commitChange((prev) => {
                        const cur = prev.questions[qIdx];
                        const used = new Set(cur.options!.map((o) => o.id));
                        const nextLetter = letters.find((l) => !used.has(l)) || `o${cur.options!.length}`;
                        cur.options!.push({ id: nextLetter, text: '' });
                        return prev;
                      })
                    }
                    className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Нұсқа қосу
                  </button>
                )}
              </div>
            )}

            {q.type === 'true_false' && (
              <div className="flex items-center gap-3">
                {(['true', 'false'] as const).map((val) => {
                  const active = q.correct.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() =>
                        commitChange((prev) => {
                          prev.questions[qIdx].correct = [val];
                          return prev;
                        })
                      }
                      className={`h-10 px-5 rounded-xl border-2 text-sm font-semibold transition-colors ${
                        active
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {val === 'true' ? t('true_label') : t('false_label')}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === 'short_answer' && (
              <div className="space-y-2.5">
                <input
                  type="text"
                  value={q.correct.join('; ')}
                  onChange={(e) =>
                    commitChange((prev) => {
                      prev.questions[qIdx].correct = e.target.value
                        .split(';')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      return prev;
                    })
                  }
                  placeholder="Қабылданатын жауаптар (; арқылы бөліңіз; бос қалса қолмен бағаланады)"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
                <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(q.caseSensitive)}
                      onChange={(e) =>
                        commitChange((prev) => {
                          prev.questions[qIdx].caseSensitive = e.target.checked;
                          return prev;
                        })
                      }
                      className="accent-emerald-600"
                    />
                    Регистрге сезімтал (Бас/кіші әріп)
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={q.ignoreSpacesAndDashes !== false}
                      onChange={(e) =>
                        commitChange((prev) => {
                          prev.questions[qIdx].ignoreSpacesAndDashes = e.target.checked;
                          return prev;
                        })
                      }
                      className="accent-emerald-600"
                    />
                    Бос орын мен сызықшаларды елемеу
                  </label>
                </div>
              </div>
            )}

            {/* Explanation + AI Refine Bar */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <input
                type="text"
                value={q.explanation || ''}
                onChange={(e) =>
                  commitChange((prev) => {
                    prev.questions[qIdx].explanation = e.target.value || undefined;
                    return prev;
                  })
                }
                placeholder="Түсіндірме (оқушы жауап берген соң көрінеді, міндетті емес)…"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400 mr-1">AI көмекші:</span>
                {(
                  [
                    ['harder', 'Қиындат'],
                    ['easier', 'Жеңілдет'],
                    ['add_options', 'Нұсқалар қос'],
                    ['write_explanation', 'Түсіндірме жаз'],
                  ] as const
                ).map(([act, label]) => (
                  <button
                    key={act}
                    type="button"
                    disabled={!aiEnabled || refiningId === q.id}
                    title={!aiEnabled ? t('ai_disabled_notice') : label}
                    onClick={() => void handleAiRefine(q, act)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-emerald-500 disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    {refiningId === q.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                    )}
                    {label}
                  </button>
                ))}
              </div>

              {/* AI Refine Suggestion Diff Box */}
              {refineSuggestion && refineSuggestion.questionId === q.id && (
                <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 space-y-2 text-xs">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                    AI ұсынысы (қабылдау үшін басыңыз):
                  </div>
                  {refineSuggestion.suggestion.text && (
                    <div>
                      <strong>Сұрақ:</strong> <RichText text={refineSuggestion.suggestion.text} />
                    </div>
                  )}
                  {refineSuggestion.suggestion.explanation && (
                    <div>
                      <strong>Түсіндірме:</strong>{' '}
                      <RichText text={refineSuggestion.suggestion.explanation} />
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        commitChange((prev) => {
                          prev.questions[qIdx] = {
                            ...prev.questions[qIdx],
                            ...refineSuggestion.suggestion,
                          };
                          return prev;
                        });
                        setRefineSuggestion(null);
                      }}
                      className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                    >
                      Қабылдау
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefineSuggestion(null)}
                      className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                    >
                      Бас тарту
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Question Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3 p-5 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700">
        {(
          [
            ['multiple_choice', '+ Көп таңдау'],
            ['true_false', '+ Дұрыс / Қате'],
            ['short_answer', '+ Қысқа жауап'],
          ] as const
        ).map(([type, label]) => (
          <button
            key={type}
            type="button"
            onClick={() =>
              commitChange((prev) => {
                prev.questions.push(createEmptyQuestion(type, prev.questions.length));
                return prev;
              })
            }
            className="h-11 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-emerald-600 text-sm font-semibold text-slate-800 dark:text-slate-100"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Student Preview Modal */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Алдын ала қарау: ${quiz.title}`}
        subtitle="Оқушы экранында қалай көрінетіні"
        size="lg"
      >
        <div className="space-y-4">
          {quiz.questions.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">Сұрақтар әлі қосылмаған.</p>
          ) : (
            quiz.questions.map((q, idx) => (
              <div
                key={q.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  <span className="font-mono text-emerald-600 mr-2">{idx + 1}.</span>
                  <RichText text={q.text || '(Мәтін бос)'} />
                </div>
                {q.imageUrl && (
                  <img src={q.imageUrl} alt="Сұрақ" className="max-h-56 rounded-lg border" />
                )}
                {q.type === 'short_answer' ? (
                  <div className="h-10 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-3 flex items-center text-xs text-slate-400">
                    Оқушы жауап жазатын өріс…
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {q.options?.map((o) => (
                      <div
                        key={o.id}
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm flex items-center gap-2"
                      >
                        <span className="font-mono text-xs font-bold text-slate-400">
                          {o.id.toUpperCase()})
                        </span>
                        <RichText text={o.text} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* AI Generate Questions Modal */}
      <Modal
        open={aiGenOpen}
        onClose={() => setAiGenOpen(false)}
        title="AI сұрақ генерациясы (Gemini)"
        subtitle="Ұсынылған сұрақтарды тексеріп, викторинаға қосыңыз"
        size="lg"
      >
        <div className="space-y-5">
          <form onSubmit={handleAiGenerate} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <input
              type="text"
              required
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="Тақырып (мысалы: Пифагор теоремасы, Қазақ хандығы)"
              className="sm:col-span-6 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
            <input
              type="text"
              value={aiGrade}
              onChange={(e) => setAiGrade(e.target.value)}
              placeholder="Сынып"
              className="sm:col-span-2 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
            <select
              value={aiDifficulty}
              onChange={(e) => setAiDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
              className="sm:col-span-2 h-10 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="easy">Жеңіл</option>
              <option value="medium">Орташа</option>
              <option value="hard">Күрделі</option>
            </select>
            <input
              type="number"
              min={1}
              max={15}
              value={aiCount}
              onChange={(e) => setAiCount(Math.max(1, Math.min(15, Number(e.target.value) || 5)))}
              className="sm:col-span-2 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={aiLoading}
              className="sm:col-span-12 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Сұрақтар генерациялау
            </button>
          </form>

          {aiSuggestions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Ұсыныстар ({aiSuggestions.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    commitChange((prev) => {
                      prev.questions.push(...aiSuggestions);
                      return prev;
                    });
                    setAiSuggestions([]);
                    setAiGenOpen(false);
                    toast.success('Барлық ұсынылған сұрақтар қосылды');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  Барлығын қосу
                </button>
              </div>
              {aiSuggestions.map((sg, idx) => (
                <div
                  key={sg.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">
                      <RichText text={sg.text} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        commitChange((prev) => {
                          prev.questions.push(sg);
                          return prev;
                        });
                        setAiSuggestions((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold shrink-0"
                    >
                      Қосу
                    </button>
                  </div>
                  {sg.options && (
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {sg.options.map((o) => `${o.id.toUpperCase()}) ${o.text}`).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
