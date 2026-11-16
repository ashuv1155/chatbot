import type { Attachment } from '../types/chat';

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function getImageDimensions(
  src: string,
): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(undefined);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogv|m4v)$/i;

export async function processUploadedFile(
  file: File,
  id: string,
): Promise<Attachment | null> {
  const mime = (file.type || '').toLowerCase();
  const name = file.name || 'attachment';

  const isSvg = mime === 'image/svg+xml' || /\.svg$/i.test(name);
  const isImage = !isSvg && (mime.startsWith('image/') || IMAGE_EXT_RE.test(name));
  const isAudio = mime.startsWith('audio/') || AUDIO_EXT_RE.test(name);
  const isVideo = mime.startsWith('video/') || VIDEO_EXT_RE.test(name);

  if (isSvg) {
    if (file.size > 1_500_000) return null;
    try {
      const [content, previewUrl] = await Promise.all([
        readFileAsText(file),
        readFileAsDataUrl(file),
      ]);
      const dimensions = await getImageDimensions(previewUrl);
      return {
        id,
        name,
        size: file.size,
        content,
        mimeType: 'image/svg+xml',
        kind: 'image',
        previewUrl,
        dimensions,
      };
    } catch {
      return null;
    }
  }

  if (isImage) {
    if (file.size > 4_000_000) return null;
    try {
      const previewUrl = await readFileAsDataUrl(file);
      const dimensions = await getImageDimensions(previewUrl);
      return {
        id,
        name,
        size: file.size,
        content: '',
        mimeType: mime || 'image/png',
        kind: 'image',
        previewUrl,
        dimensions,
      };
    } catch {
      return null;
    }
  }

  if (isAudio || isVideo) {
    if (file.size > 8_000_000) return null;
    try {
      const previewUrl = await readFileAsDataUrl(file);
      return {
        id,
        name,
        size: file.size,
        content: '',
        mimeType: mime || (isAudio ? 'audio/mpeg' : 'video/mp4'),
        kind: isAudio ? 'audio' : 'video',
        previewUrl,
      };
    } catch {
      return null;
    }
  }

  if (file.size > 1_500_000) return null;
  try {
    const content = await readFileAsText(file);
    return {
      id,
      name,
      size: file.size,
      content,
      mimeType: mime || 'text/plain',
      kind: 'text',
    };
  } catch {
    return null;
  }
}

export function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revocation so Firefox and Safari finish reading the blob URL
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadUrl(filename: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function supportsSpeechRecognition(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function createSpeechRecognition(): SpeechRecognitionInstance | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  return new Ctor();
}

export function supportsSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speakText(
  text: string,
  onEnd?: () => void,
  onError?: () => void,
): boolean {
  if (!supportsSpeechSynthesis()) return false;
  try {
    window.speechSynthesis.cancel();
    const cleaned = stripMarkdownForSpeech(text);
    if (!cleaned) return false;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = 1.02;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onError?.();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    onError?.();
    return false;
  }
}

export function stopSpeaking(): void {
  if (supportsSpeechSynthesis()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }
}
