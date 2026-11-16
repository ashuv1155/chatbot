import { useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  Monitor,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import type { PreviewArtifact } from '../types/chat';
import { copyToClipboard, downloadFile } from '../lib/browser';

interface ArtifactPreviewProps {
  artifact: PreviewArtifact | null;
  onClose: () => void;
}

export function ArtifactPreview({ artifact, onClose }: ArtifactPreviewProps) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!artifact) return null;

  const srcDoc =
    artifact.language === 'svg'
      ? `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:16px;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#ffffff;box-sizing:border-box;}svg{max-width:100%;height:auto;}</style></head><body>${artifact.code}</body></html>`
      : artifact.code;

  const handleCopy = async () => {
    const ok = await copyToClipboard(artifact.code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    const ext = artifact.language === 'svg' ? 'svg' : 'html';
    const mime =
      artifact.language === 'svg'
        ? 'image/svg+xml;charset=utf-8'
        : 'text/html;charset=utf-8';
    downloadFile(`ashutosh-gpt-preview.${ext}`, artifact.code, mime);
  };

  return (
    <section
      aria-label="Live artifact preview"
      className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[46%] lg:max-w-[680px] flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] no-print"
    >
      {/* Toolbar */}
      <div className="h-14 shrink-0 flex items-center justify-between px-3.5 border-b border-zinc-200 dark:border-zinc-800 gap-2">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tab === 'preview'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('code')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tab === 'code'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Source</span>
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {tab === 'preview' && (
            <>
              <button
                type="button"
                onClick={() =>
                  setViewport((v) => (v === 'desktop' ? 'mobile' : 'desktop'))
                }
                title={
                  viewport === 'desktop'
                    ? 'Switch to mobile width (375px)'
                    : 'Switch to full width'
                }
                className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {viewport === 'desktop' ? (
                  <Monitor className="w-4 h-4" />
                ) : (
                  <Smartphone className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                title="Reload preview"
                className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy source"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            title="Download file"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-[#0d0d0f] p-3 flex justify-center">
        {tab === 'preview' ? (
          <div
            className={`h-full bg-white rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm transition-all duration-200 ${
              viewport === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'
            }`}
          >
            <iframe
              key={`${artifact.id}-${refreshKey}`}
              title={artifact.title}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="w-full h-full border-0 bg-white"
            />
          </div>
        ) : (
          <div className="w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 p-4">
            <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">
              <code>{artifact.code}</code>
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
