import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Combine,
  Copy,
  Download,
  Edit3,
  FileDown,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Grid,
  Import,
  List,
  Play,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Folder, Question, QuestionType, Quiz } from '../../types.ts';
import { api, downloadAuthenticatedFile } from '../../lib/api.ts';
import { copyToClipboard, formatDateShort } from '../../lib/utils.ts';
import { useI18n } from '../../lib/i18n.ts';
import { ConfirmDialog, Modal } from '../shared/Modal.tsx';
import { RichText } from '../shared/RichText.tsx';
import { useToast } from '../shared/Toast.tsx';

export const QuizLibrary: React.FC<{
  aiEnabled: boolean;
  onEditQuiz: (quizId: string) => void;
  onLaunchQuiz: (quizId: string) => void;
}> = ({ aiEnabled, onEditQuiz, onLaunchQuiz }) => {
  const { t, locale } = useI18n();
  const toast = useToast();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [trashQuizzes, setTrashQuizzes] = useState<Quiz[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showTrash, setShowTrash] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'ALL' | 'ROOT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Folder modals
  const [folderModal, setFolderModal] = useState<{
    mode: 'create' | 'rename';
    parentId?: string | null;
    folder?: Folder;
  } | null>(null);
  const [folderNameInput, setFolderNameInput] = useState('');

  // Share modal
  const [shareQuiz, setShareQuiz] = useState<Quiz | null>(null);

  // Import by Share Code modal
  const [codeImportOpen, setCodeImportOpen] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');

  // Merge modal
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTitle, setMergeTitle] = useState('');

  // Move modal
  const [moveTargets, setMoveTargets] = useState<string[] | null>(null);
  const [moveFolderId, setMoveFolderId] = useState<string>('');

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; permanent: boolean } | null>(
    null
  );

  // Document Import modal (Upload / Paste -> Preview & Edit -> Save)
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<'input' | 'preview'>('input');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPaste, setImportPaste] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importTitle, setImportTitle] = useState('');
  const [parsedQuestions, setParsedQuestions] = useState<(Question & { selected: boolean })[]>([]);

  const loadAll = async () => {
    try {
      const [qRes, tRes, fRes] = await Promise.all([
        api.getQuizzes(false),
        api.getQuizzes(true),
        api.getFolders(),
      ]);
      setQuizzes(qRes.quizzes);
      setTrashQuizzes(tRes.quizzes);
      setFolders(fRes.folders);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const filteredQuizzes = useMemo(() => {
    const base = showTrash ? trashQuizzes : quizzes;
    const q = searchQuery.trim().toLowerCase();
    return base
      .filter((item) => {
        if (!showTrash) {
          if (selectedFolderId === 'ROOT' && item.folderId !== null) return false;
          if (selectedFolderId !== 'ALL' && selectedFolderId !== 'ROOT' && item.folderId !== selectedFolderId) {
            return false;
          }
        }
        if (!q) return true;
        if (item.title.toLowerCase().includes(q)) return true;
        if (item.shareCode.toLowerCase().includes(q)) return true;
        return item.questions.some((qq) => qq.text.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title, 'kk');
        if (sortBy === 'created')
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [quizzes, trashQuizzes, showTrash, selectedFolderId, searchQuery, sortBy]);

  const handleCreateQuiz = async () => {
    try {
      const folderId =
        selectedFolderId !== 'ALL' && selectedFolderId !== 'ROOT' ? selectedFolderId : null;
      const { quiz } = await api.createQuiz({
        title: 'Жаңа викторина',
        folderId,
        questions: [],
      });
      onEditQuiz(quiz.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderModal || !folderNameInput.trim()) return;
    try {
      if (folderModal.mode === 'create') {
        await api.createFolder(folderNameInput.trim(), folderModal.parentId ?? null);
        toast.success('Қалта құрылды');
      } else if (folderModal.folder) {
        await api.updateFolder(folderModal.folder.id, { name: folderNameInput.trim() });
        toast.success('Қалта атауы өзгертілді');
      }
      setFolderModal(null);
      setFolderNameInput('');
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDropQuizOnFolder = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    const quizId = e.dataTransfer.getData('text/quiz-id');
    if (!quizId) return;
    try {
      await api.updateQuiz(quizId, { folderId: targetFolderId });
      toast.success('Викторина қалтаға жылжытылды');
      await loadAll();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleParseImport = async (mode: 'structured' | 'ai') => {
    if (!importFile && !importPaste.trim()) {
      toast.error('Файл таңдаңыз немесе мәтін қойыңыз.');
      return;
    }
    setImportLoading(true);
    setImportWarnings([]);
    try {
      let res: { questions: Question[]; warnings: string[] };
      if (importFile) {
        const fd = new FormData();
        fd.append('file', importFile);
        fd.append('language', locale);
        res = mode === 'ai' ? await api.importWithAi(fd) : await api.importStructured(fd);
      } else {
        res =
          mode === 'ai'
            ? await api.importWithAi({ text: importPaste, language: locale })
            : await api.importStructured(importPaste);
      }
      setImportWarnings(res.warnings || []);
      setParsedQuestions(res.questions.map((q) => ({ ...q, selected: true })));
      if (!importTitle) {
        setImportTitle(
          importFile
            ? importFile.name.replace(/\.[^.]+$/, '')
            : 'Импортталған викторина'
        );
      }
      setImportStep('preview');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleSaveImportedQuiz = async () => {
    const chosen = parsedQuestions.filter((q) => q.selected).map(({ selected: _s, ...q }, i) => ({
      ...q,
      order: i,
    }));
    if (chosen.length === 0) {
      toast.error('Кемінде 1 сұрақты таңдаңыз.');
      return;
    }
    try {
      const folderId =
        selectedFolderId !== 'ALL' && selectedFolderId !== 'ROOT' ? selectedFolderId : null;
      const { quiz } = await api.createQuiz({
        title: importTitle.trim() || 'Импортталған викторина',
        folderId,
        questions: chosen,
      });
      toast.success(`${chosen.length} сұрақ сәтті импортталды`);
      setImportOpen(false);
      setImportStep('input');
      setImportFile(null);
      setImportPaste('');
      setParsedQuestions([]);
      await loadAll();
      onEditQuiz(quiz.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const renderFolderTree = (parentId: string | null = null, depth = 0): React.ReactNode => {
    const children = folders.filter((f) => f.parentId === parentId);
    return children.map((f) => (
      <div key={f.id}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void handleDropQuizOnFolder(e, f.id)}
          className={`group flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
            !showTrash && selectedFolderId === f.id
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold'
              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          onClick={() => {
            setShowTrash(false);
            setSelectedFolderId(f.id);
          }}
        >
          <span className="inline-flex items-center gap-2 min-w-0 truncate">
            <FolderIcon className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate">{f.name}</span>
          </span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title="Ішкі қалта қосу"
              onClick={(e) => {
                e.stopPropagation();
                setFolderModal({ mode: 'create', parentId: f.id });
                setFolderNameInput('');
              }}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Атын өзгерту"
              onClick={(e) => {
                e.stopPropagation();
                setFolderModal({ mode: 'rename', folder: f });
                setFolderNameInput(f.name);
              }}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Қалтаны жою"
              onClick={async (e) => {
                e.stopPropagation();
                await api.deleteFolder(f.id);
                if (selectedFolderId === f.id) setSelectedFolderId('ALL');
                toast.success('Қалта жойылды (викториналар сақталды)');
                await loadAll();
              }}
              className="p-1 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-950/40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {renderFolderTree(f.id, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="space-y-6">
      {/* Header & Main Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t('nav_quizzes')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Викториналарды қалталарға сүйреп реттеңіз, Word/Excel/PDF-тен импорттаңыз және бөлісу кодымен алмасыңыз.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setCodeImportOpen(true)}
            className="h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Import className="w-4 h-4" />
            Код бойынша
          </button>
          <button
            type="button"
            onClick={() => {
              setImportOpen(true);
              setImportStep('input');
            }}
            className="h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            Импорттау
          </button>
          <button
            type="button"
            onClick={handleCreateQuiz}
            className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {t('new_quiz')}
          </button>
        </div>
      </div>

      {/* Main Layout: Folders Sidebar + Quizzes Grid/List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Folders Sidebar */}
        <aside className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Қалталар
            </span>
            <button
              type="button"
              onClick={() => {
                setFolderModal({ mode: 'create', parentId: null });
                setFolderNameInput('');
              }}
              className="p-1.5 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              title="Жаңа қалта"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowTrash(false);
              setSelectedFolderId('ALL');
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${
              !showTrash && selectedFolderId === 'ALL'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Барлық викториналар</span>
            <span className="font-mono text-xs tabular-nums">{quizzes.length}</span>
          </button>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void handleDropQuizOnFolder(e, null)}
            onClick={() => {
              setShowTrash(false);
              setSelectedFolderId('ROOT');
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between cursor-pointer ${
              !showTrash && selectedFolderId === 'ROOT'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Қалтасыз</span>
            <span className="font-mono text-xs tabular-nums">
              {quizzes.filter((q) => !q.folderId).length}
            </span>
          </div>

          <div className="space-y-0.5">{renderFolderTree(null, 0)}</div>

          <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowTrash(true);
                setSelectedIds([]);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${
                showTrash
                  ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Себет (30 күн)
              </span>
              <span className="font-mono text-xs tabular-nums">{trashQuizzes.length}</span>
            </button>
          </div>
        </aside>

        {/* Right Panel */}
        <div className="lg:col-span-9 space-y-4">
          {/* Toolbar: Search, Sort, View Toggle, Bulk Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Атауы, бөлісу коды немесе сұрақ мәтіні бойынша іздеу…"
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'updated' | 'created' | 'title')}
                className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
              >
                <option value="updated">Өзгертілген уақыты</option>
                <option value="created">Жаңа қосылғандар</option>
                <option value="title">Атауы (А–Я)</option>
              </select>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Тізім"
                  className={`p-2 rounded-lg ${
                    viewMode === 'list'
                      ? 'bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Тор"
                  className={`p-2 rounded-lg ${
                    viewMode === 'grid'
                      ? 'bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {!showTrash && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm">
              <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                Таңдалды: {selectedIds.length}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {selectedIds.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMergeTitle('Біріктірілген викторина');
                      setMergeOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Combine className="w-3.5 h-3.5" />
                    Біріктіру
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMoveTargets(selectedIds);
                    setMoveFolderId('');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                >
                  Қалтаға жылжыту
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ ids: selectedIds, permanent: false })}
                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold"
                >
                  Себетке жіберу
                </button>
              </div>
            </div>
          )}

          {/* Quizzes Display */}
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-200 dark:bg-slate-800" />
              ))}
            </div>
          ) : filteredQuizzes.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3">
              <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {showTrash ? 'Себет бос' : 'Викториналар табылмады'}
              </div>
              {!showTrash && (
                <button
                  type="button"
                  onClick={handleCreateQuiz}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
                >
                  Бірінші викторинаны құру
                </button>
              )}
            </div>
          ) : (
            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden'
              }
            >
              {filteredQuizzes.map((qz) => {
                const checked = selectedIds.includes(qz.id);
                const folderName = folders.find((f) => f.id === qz.folderId)?.name;

                return (
                  <div
                    key={qz.id}
                    draggable={!showTrash}
                    onDragStart={(e) => e.dataTransfer.setData('text/quiz-id', qz.id)}
                    className={
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-emerald-400 transition-colors'
                        : 'p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors'
                    }
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {!showTrash && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked
                                ? [...prev, qz.id]
                                : prev.filter((x) => x !== qz.id)
                            )
                          }
                          className="mt-1 w-4 h-4 accent-emerald-600 shrink-0"
                          aria-label={qz.title}
                        />
                      )}
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => !showTrash && onEditQuiz(qz.id)}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 text-left block truncate max-w-full"
                        >
                          {qz.title}
                        </button>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="font-mono tabular-nums">{qz.questions.length} сұрақ</span>
                          <span>·</span>
                          <span className="font-mono">{qz.shareCode}</span>
                          {folderName && (
                            <>
                              <span>·</span>
                              <span>{folderName}</span>
                            </>
                          )}
                          <span>·</span>
                          <span className="tabular-nums">{formatDateShort(qz.updatedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {showTrash ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.restoreQuiz(qz.id);
                              toast.success('Викторина қалпына келтірілді');
                              await loadAll();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Қалпына келтіру
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ ids: [qz.id], permanent: true })}
                            className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-semibold"
                          >
                            Біржола жою
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onLaunchQuiz(qz.id)}
                            title="Іске қосу"
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Іске қосу
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditQuiz(qz.id)}
                            title="Өңдеу"
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.duplicateQuiz(qz.id);
                              toast.success('Дубликат жасалды');
                              await loadAll();
                            }}
                            title="Дубликат"
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareQuiz(qz)}
                            title="Бөлісу және Word экспорт"
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ ids: [qz.id], permanent: false })}
                            title="Себетке жіберу"
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Share & Export DOCX Modal */}
      <Modal
        open={Boolean(shareQuiz)}
        onClose={() => setShareQuiz(null)}
        title="Викторинамен бөлісу және Word экспорт"
        subtitle={shareQuiz?.title}
        size="md"
      >
        {shareQuiz && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Ортақ бөлісу коды</div>
                <div className="font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 select-all">
                  {shareQuiz.shareCode}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(shareQuiz.shareCode);
                  toast.success('Код көшірілді');
                }}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Көшіру
              </button>
            </div>

            <div className="space-y-2.5">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Жария сілтеме (басқалар сілтеме арқылы қарай алады)
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(shareQuiz.isPublic)}
                  onChange={async (e) => {
                    const { quiz } = await api.shareQuiz(shareQuiz.id, {
                      isPublic: e.target.checked,
                    });
                    setShareQuiz(quiz);
                    await loadAll();
                  }}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>

              {shareQuiz.isPublic && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/share/${shareQuiz.shareCode}`}
                    className="flex-1 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(`${window.location.origin}/share/${shareQuiz.shareCode}`);
                      toast.success('Жария сілтеме көшірілді');
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    Көшіру
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Word (.docx) экспорт
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    void downloadAuthenticatedFile(
                      `/api/quizzes/${shareQuiz.id}/export.docx?key=true`,
                      `${shareQuiz.title}_key.docx`
                    )
                  }
                  className="h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4 text-emerald-600" />
                  Жауап кілтімен
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void downloadAuthenticatedFile(
                      `/api/quizzes/${shareQuiz.id}/export.docx?key=false`,
                      `${shareQuiz.title}_student.docx`
                    )
                  }
                  className="h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4 text-slate-500" />
                  Оқушыға (кілтсіз)
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Import By Share Code Modal */}
      <Modal
        open={codeImportOpen}
        onClose={() => setCodeImportOpen(false)}
        title="Код бойынша импорттау"
        subtitle="Басқа мұғалім бөліскен QZ-XXXXXX кодын енгізіңіз"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCodeImportOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.importByShareCode(shareCodeInput.trim());
                  toast.success('Викторина кітапханаңызға қосылды');
                  setCodeImportOpen(false);
                  setShareCodeInput('');
                  await loadAll();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Импорттау
            </button>
          </>
        }
      >
        <input
          type="text"
          value={shareCodeInput}
          onChange={(e) => setShareCodeInput(e.target.value.toUpperCase())}
          placeholder="QZ-4F7K2A"
          className="w-full h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xl uppercase text-center"
        />
      </Modal>

      {/* Folder Create/Rename Modal */}
      <Modal
        open={Boolean(folderModal)}
        onClose={() => setFolderModal(null)}
        title={folderModal?.mode === 'rename' ? 'Қалта атын өзгерту' : 'Жаңа қалта'}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setFolderModal(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="folder-form"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              {t('save')}
            </button>
          </>
        }
      >
        <form id="folder-form" onSubmit={handleFolderSubmit}>
          <input
            type="text"
            required
            autoFocus
            value={folderNameInput}
            onChange={(e) => setFolderNameInput(e.target.value)}
            placeholder="Мысалы: 7-сынып Алгебра"
            className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </form>
      </Modal>

      {/* Merge Modal */}
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Таңдалған викториналарды біріктіру"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMergeOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.mergeQuizzes(selectedIds, mergeTitle);
                  toast.success('Викториналар сәтті біріктірілді');
                  setMergeOpen(false);
                  setSelectedIds([]);
                  await loadAll();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Біріктіру
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Жаңа викторина атауы
          </label>
          <input
            type="text"
            value={mergeTitle}
            onChange={(e) => setMergeTitle(e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      </Modal>

      {/* Move to Folder Modal */}
      <Modal
        open={Boolean(moveTargets)}
        onClose={() => setMoveTargets(null)}
        title="Қалтаға жылжыту"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMoveTargets(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!moveTargets) return;
                for (const id of moveTargets) {
                  await api.updateQuiz(id, { folderId: moveFolderId || null });
                }
                toast.success('Қалтаға жылжытылды');
                setMoveTargets(null);
                setSelectedIds([]);
                await loadAll();
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Жылжыту
            </button>
          </>
        }
      >
        <select
          value={moveFolderId}
          onChange={(e) => setMoveFolderId(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
        >
          <option value="">Қалтасыз (Түбір)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Modal>

      {/* Document Import Modal (Upload/Paste -> Preview & Edit) */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={
          importStep === 'input'
            ? 'Құжаттан сұрақтарды импорттау'
            : `Алдын ала қарау және түзету (${parsedQuestions.filter((q) => q.selected).length} таңдалды)`
        }
        size="xl"
        footer={
          importStep === 'input' ? (
            <>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={importLoading}
                onClick={() => void handleParseImport('structured')}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                {importLoading ? t('loading') : 'Жылдам құрылымдық тану'}
              </button>
              <button
                type="button"
                disabled={importLoading || !aiEnabled}
                title={!aiEnabled ? t('ai_disabled_notice') : ''}
                onClick={() => void handleParseImport('ai')}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-45 text-sm font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                AI тану (Gemini)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setImportStep('input')}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              >
                Артқа
              </button>
              <button
                type="button"
                onClick={handleSaveImportedQuiz}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Таңдалғандарды қосу
              </button>
            </>
          )
        }
      >
        {importStep === 'input' ? (
          <div className="space-y-5">
            {!aiEnabled && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                {t('ai_disabled_notice')}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div className="text-sm text-slate-700 dark:text-slate-300">
                Excel үлгісі (бағандар: Сұрақ, Түрі, A–F, Дұрыс жауап, Ұпай, Түсіндірме)
              </div>
              <button
                type="button"
                onClick={() =>
                  void downloadAuthenticatedFile('/api/import/template.xlsx', 'quizkz-template.xlsx')
                }
                className="px-3.5 py-2 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Excel үлгісін жүктеу
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Файл жүктеу (.docx, .xlsx, .xls, .pdf, .txt, .csv)
              </label>
              <input
                type="file"
                accept=".docx,.xlsx,.xls,.pdf,.txt,.csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Немесе сұрақтар мәтінін тікелей қойыңыз
              </label>
              <textarea
                rows={7}
                value={importPaste}
                onChange={(e) => setImportPaste(e.target.value)}
                placeholder={`1. Қазақстанның астанасы қай қала?\nA) Алматы\n*B) Астана\nC) Шымкент\n\n2. $2^5$ нешеге тең?\nЖауабы: 32`}
                className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs sm:text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Жаңа викторина атауы
              </label>
              <input
                type="text"
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-semibold"
              />
            </div>

            {importWarnings.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                {importWarnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {parsedQuestions.map((pq, idx) => {
                const missingAnswer = pq.correct.length === 0;
                return (
                  <div
                    key={pq.id}
                    className={`p-4 rounded-xl border space-y-3 ${
                      missingAnswer
                        ? 'border-amber-400 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold">
                        <input
                          type="checkbox"
                          checked={pq.selected}
                          onChange={(e) =>
                            setParsedQuestions((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, selected: e.target.checked } : x
                              )
                            )
                          }
                          className="accent-emerald-600"
                        />
                        <span>Сұрақ #{idx + 1}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        {missingAnswer && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Дұрыс жауабы белгісіз
                          </span>
                        )}
                        <select
                          value={pq.type}
                          onChange={(e) => {
                            const nextType = e.target.value as QuestionType;
                            setParsedQuestions((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? {
                                      ...x,
                                      type: nextType,
                                      options:
                                        nextType === 'true_false'
                                          ? [
                                              { id: 'true', text: 'Дұрыс' },
                                              { id: 'false', text: 'Қате' },
                                            ]
                                          : nextType === 'multiple_choice'
                                          ? x.options?.length
                                            ? x.options
                                            : [
                                                { id: 'a', text: 'A' },
                                                { id: 'b', text: 'B' },
                                              ]
                                          : undefined,
                                      correct: [],
                                    }
                                  : x
                              )
                            );
                          }}
                          className="h-8 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          <option value="multiple_choice">Көп таңдау</option>
                          <option value="true_false">Дұрыс/Қате</option>
                          <option value="short_answer">Қысқа жауап</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={pq.points}
                          onChange={(e) =>
                            setParsedQuestions((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, points: Number(e.target.value) || 1 } : x
                              )
                            )
                          }
                          className="w-16 h-8 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={pq.text}
                      onChange={(e) =>
                        setParsedQuestions((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x))
                        )
                      }
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                    {pq.text.includes('$') && (
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Формула көрінісі: <RichText text={pq.text} />
                      </div>
                    )}

                    {pq.type === 'short_answer' ? (
                      <input
                        type="text"
                        value={pq.correct.join('; ')}
                        onChange={(e) =>
                          setParsedQuestions((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    correct: e.target.value
                                      .split(';')
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  }
                                : x
                            )
                          )
                        }
                        placeholder="Қабылданатын жауаптар (; арқылы бөліңіз)"
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      />
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pq.options?.map((opt, oi) => {
                          const isCorr = pq.correct.includes(opt.id);
                          return (
                            <div key={opt.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isCorr}
                                onChange={(e) =>
                                  setParsedQuestions((prev) =>
                                    prev.map((x, i) => {
                                      if (i !== idx) return x;
                                      const nextCorr = e.target.checked
                                        ? [...new Set([...x.correct, opt.id])]
                                        : x.correct.filter((c) => c !== opt.id);
                                      return { ...x, correct: nextCorr };
                                    })
                                  )
                                }
                                className="accent-emerald-600"
                              />
                              <input
                                type="text"
                                value={opt.text}
                                onChange={(e) =>
                                  setParsedQuestions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx && x.options
                                        ? {
                                            ...x,
                                            options: x.options.map((oo, oIdx) =>
                                              oIdx === oi ? { ...oo, text: e.target.value } : oo
                                            ),
                                          }
                                        : x
                                    )
                                  )
                                }
                                className="flex-1 h-8 px-2.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        title={deleteTarget?.permanent ? 'Біржола жою' : 'Себетке жіберу'}
        message={
          deleteTarget?.permanent
            ? 'Таңдалған викторина біржола жойылады және қалпына келтірілмейді.'
            : 'Таңдалған викториналар себетке жіберіледі (30 күн ішінде қалпына келтіруге болады).'
        }
        confirmLabel="Жою"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          for (const id of deleteTarget.ids) {
            await api.deleteQuiz(id, deleteTarget.permanent);
          }
          toast.success(deleteTarget.permanent ? 'Біржола жойылды' : 'Себетке жіберілді');
          setDeleteTarget(null);
          setSelectedIds([]);
          await loadAll();
        }}
      />
    </div>
  );
};
