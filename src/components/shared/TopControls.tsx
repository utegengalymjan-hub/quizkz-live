import React, { useEffect, useState } from 'react';
import { Check, Copy, Moon, Sun, Monitor, QrCode, ExternalLink } from 'lucide-react';
import { useI18n } from '../../lib/i18n.ts';
import type { Locale } from '../../types.ts';
import { copyToClipboard, generateQrDataUrl } from '../../lib/utils.ts';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

export const LanguageAndThemeControls: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { locale, setLocale, theme, setTheme } = useI18n();

  const cycleTheme = () => {
    const order: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const langs: { code: Locale; label: string }[] = [
    { code: 'kk', label: 'ҚАЗ' },
    { code: 'ru', label: 'РУС' },
    { code: 'en', label: 'ENG' },
  ];

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 p-0.5"
        role="group"
        aria-label="Тіл таңдау"
      >
        {langs.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLocale(l.code)}
            className={`${
              compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'
            } font-medium rounded-md transition-colors whitespace-nowrap ${
              locale === l.code
                ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={cycleTheme}
        title={
          theme === 'light'
            ? 'Жарық тақырып'
            : theme === 'dark'
            ? 'Қараңғы тақырып'
            : 'Жүйелік тақырып'
        }
        aria-label="Тақырыпты ауыстыру"
        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        {theme === 'light' ? (
          <Sun className="w-4 h-4" />
        ) : theme === 'dark' ? (
          <Moon className="w-4 h-4" />
        ) : (
          <Monitor className="w-4 h-4" />
        )}
      </button>
    </div>
  );
};

export const RoomQrModal: React.FC<{
  open: boolean;
  onClose: () => void;
  roomName: string;
}> = ({ open, onClose, roomName }) => {
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const toast = useToast();
  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join?room=${encodeURIComponent(roomName)}`
      : `/join?room=${encodeURIComponent(roomName)}`;

  useEffect(() => {
    if (!open || !roomName) return;
    generateQrDataUrl(joinUrl)
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [open, roomName, joinUrl]);

  const handleCopy = async (val: string, kind: 'code' | 'link') => {
    const ok = await copyToClipboard(val);
    if (ok) {
      if (kind === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 1800);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 1800);
      }
      toast.success('Алмасу буферіне көшірілді');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Оқушыларды бөлмеге шақыру"
      subtitle="Проектордан көрсетіңіз немесе тікелей сілтемені жіберіңіз"
      size="md"
    >
      <div className="flex flex-col items-center text-center space-y-5 py-2">
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Бөлме атауы
          </div>
          <div className="font-mono text-4xl sm:text-5xl font-bold tracking-wider text-emerald-700 dark:text-emerald-400 select-all">
            {roomName}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={`QR-код ${roomName}`}
              className="w-56 h-56 block"
            />
          ) : (
            <div className="w-56 h-56 flex items-center justify-center text-slate-400">
              <QrCode className="w-12 h-12" />
            </div>
          )}
        </div>

        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            readOnly
            value={joinUrl}
            className="flex-1 px-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={() => handleCopy(joinUrl, 'link')}
            className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Сілтемені көшіру
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => handleCopy(roomName, 'code')}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2"
          >
            {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            Бөлме атауын көшіру
          </button>
          <a
            href={joinUrl}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Оқушы бетін ашу
          </a>
        </div>
      </div>
    </Modal>
  );
};
