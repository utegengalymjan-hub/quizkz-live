import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}с`;
  return `${min}м ${sec.toString().padStart(2, '0')}с`;
}

export function formatCountdown(endsAt?: string | null): string | null {
  if (!endsAt) return null;
  const diff = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
  const min = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export function formatDateShort(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('kk-KZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 280,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

export function readImageFileAsDataUrl(file: File, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Тек сурет файлдарын (PNG, JPG, WebP, SVG) жүктеуге болады.'));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error('Сурет өлшемі 2 МБ-тан аспауы керек.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Суретті оқу мүмкін болмады.'));
    reader.readAsDataURL(file);
  });
}

// Lightweight History API SPA router (no react-router needed)
export function navigateTo(path: string, replace = false) {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute() {
  const [loc, setLoc] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPop = () => {
      setLoc({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return {
    pathname: loc.pathname,
    search: loc.search,
    params: new URLSearchParams(loc.search),
    navigate: navigateTo,
  };
}
