import { useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileAudio,
  FileVideo,
  Grid,
  Image as ImageIcon,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PreviewArtifact } from '../types/chat';
import { copyToClipboard, downloadFile, downloadUrl } from '../lib/browser';
import {
  buildPreviewSrcDoc,
  exportSvgToPng,
  getPreviewFileExtension,
  getPreviewLabel,
  parseCsvRows,
  svgToDataUrl,
} from '../lib/previews';
import { MermaidDiagram } from './MermaidDiagram';

interface ArtifactPreviewProps {
  artifact: PreviewArtifact | null;
  theme?: 'dark' | 'light';
  onClose: () => void;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';
type CanvasBgMode = 'light' | 'dark' | 'checker';

const IFRAME_KINDS = new Set([
  'html',
  'react',
  'css',
  'javascript',
]);

function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (
    /^data:(image|audio|video)\//i.test(trimmed) ||
    /^blob:/i.test(trimmed)
  ) {
    return trimmed;
  }
  return defaultUrlTransform(trimmed);
}

export function ArtifactPreview({
  artifact,
  theme = 'dark',
  onClose,
}: ArtifactPreviewProps) {
  if (!artifact) return null;
  return (
    <ArtifactPreviewInner
      key={artifact.id}
      artifact={artifact}
      theme={theme}
      onClose={onClose}
    />
  );
}

function ArtifactPreviewInner({
  artifact,
  theme,
  onClose,
}: {
  artifact: PreviewArtifact;
  theme: 'dark' | 'light';
  onClose: () => void;
}) {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const [bgMode, setBgMode] = useState<CanvasBgMode>('light');
  const [zoom, setZoom] = useState<number>(100);
  const [tableFilter, setTableFilter] = useState('');
  const [jsonViewMode, setJsonViewMode] = useState<'formatted' | 'table'>('formatted');
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [svgImgFallback, setSvgImgFallback] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [renderedMermaidSvg, setRenderedMermaidSvg] = useState('');

  const isBinaryMedia =
    artifact.language === 'image' ||
    artifact.language === 'audio' ||
    artifact.language === 'video';

  const isIframeKind = IFRAME_KINDS.has(artifact.language);

  const srcDoc = useMemo(() => {
    if (!isIframeKind && !(artifact.language === 'svg' && svgImgFallback)) {
      return '';
    }
    return buildPreviewSrcDoc(artifact, theme, bgMode);
  }, [artifact, isIframeKind, svgImgFallback, theme, bgMode]);

  const svgDataUrl = useMemo(() => {
    if (artifact.language !== 'svg') return '';
    return svgToDataUrl(artifact.code);
  }, [artifact.language, artifact.code]);

  const csvRows = useMemo(() => {
    if (artifact.language !== 'csv') return [];
    return parseCsvRows(artifact.code);
  }, [artifact.language, artifact.code]);

  const jsonParsed = useMemo(() => {
    if (artifact.language !== 'json') return null;
    try {
      const value = JSON.parse(artifact.code);
      return { ok: true as const, value, formatted: JSON.stringify(value, null, 2) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }, [artifact.language, artifact.code]);

  const jsonTableData = useMemo(() => {
    if (!jsonParsed || !jsonParsed.ok) return null;
    const val = jsonParsed.value;
    if (!Array.isArray(val) || val.length === 0) return null;
    const objects = val.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
    if (objects.length === 0) return null;
    const keys = Array.from(
      new Set(objects.flatMap((obj) => Object.keys(obj))),
    ).slice(0, 16);
    if (keys.length === 0) return null;
    return { keys, rows: objects };
  }, [jsonParsed]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(artifact.code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    if (artifact.language === 'mermaid' && renderedMermaidSvg) {
      downloadFile(
        'ashutosh-gpt-diagram.svg',
        renderedMermaidSvg,
        'image/svg+xml;charset=utf-8',
      );
      return;
    }

    const ext = getPreviewFileExtension(artifact.language, artifact.filename);
    const baseName = artifact.filename
      ? artifact.filename.replace(/\.[^.]+$/, '')
      : 'ashutosh-gpt-preview';

    if (isBinaryMedia) {
      downloadUrl(`${baseName}.${ext}`, artifact.code);
      return;
    }

    const mimeMap: Record<string, string> = {
      html: 'text/html;charset=utf-8',
      svg: 'image/svg+xml;charset=utf-8',
      react: 'text/plain;charset=utf-8',
      mermaid: 'text/plain;charset=utf-8',
      markdown: 'text/markdown;charset=utf-8',
      csv: 'text/csv;charset=utf-8',
      json: 'application/json;charset=utf-8',
      css: 'text/css;charset=utf-8',
      javascript: 'application/javascript;charset=utf-8',
    };
    downloadFile(
      `${baseName}.${ext}`,
      artifact.code,
      mimeMap[artifact.language] || 'text/plain;charset=utf-8',
    );
  };

  const handleExportPng = async () => {
    const svgSource =
      artifact.language === 'svg'
        ? artifact.code
        : artifact.language === 'mermaid'
          ? renderedMermaidSvg
          : '';
    if (!svgSource) return;
    setExportingPng(true);
    await exportSvgToPng(svgSource, 'ashutosh-gpt-graphic.png');
    setExportingPng(false);
  };

  const viewportWidthClass =
    viewport === 'mobile'
      ? 'w-[375px] max-w-full'
      : viewport === 'tablet'
        ? 'w-[768px] max-w-full'
        : 'w-full';

  const checkerClass =
    bgMode === 'checker'
      ? 'bg-[length:20px_20px] bg-[linear-gradient(45deg,#e4e4e7_25%,transparent_25%),linear-gradient(-45deg,#e4e4e7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e4e4e7_75%),linear-gradient(-45deg,transparent_75%,#e4e4e7_75%)] bg-[position:0_0,0_10px,10px_-10px,-10px_0] bg-white'
      : bgMode === 'dark'
        ? 'bg-[#141416]'
        : 'bg-white';

  const csvHeader = csvRows[0] || [];
  const csvBody = csvRows.slice(1).filter((row) => {
    if (!tableFilter.trim()) return true;
    const q = tableFilter.toLowerCase();
    return row.some((cell) => cell.toLowerCase().includes(q));
  });

  const isExternalHttpUrl = /^https?:\/\//i.test(artifact.code);

  return (
    <section
      aria-label="Media and code preview"
      className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[48%] lg:max-w-[740px] flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] no-print"
    >
      {/* Toolbar */}
      <div className="min-h-14 shrink-0 flex flex-wrap items-center justify-between px-3.5 py-2 border-b border-zinc-200 dark:border-zinc-800 gap-2">
        <div className="flex items-center gap-2 min-w-0">
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
              onClick={() => setTab('source')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === 'source'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{isBinaryMedia ? 'Details' : 'Source'}</span>
            </button>
          </div>

          <span className="hidden sm:inline text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate max-w-[160px]">
            {getPreviewLabel(artifact.language)}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {tab === 'preview' &&
            (artifact.language === 'html' ||
              artifact.language === 'react' ||
              artifact.language === 'css') && (
              <>
                <button
                  type="button"
                  onClick={() => setViewport('desktop')}
                  title="Desktop width (100%)"
                  className={`p-1.5 rounded-lg transition-colors ${
                    viewport === 'desktop'
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('tablet')}
                  title="Tablet width (768px)"
                  className={`p-1.5 rounded-lg transition-colors ${
                    viewport === 'tablet'
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Tablet className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('mobile')}
                  title="Mobile width (375px)"
                  className={`p-1.5 rounded-lg transition-colors ${
                    viewport === 'mobile'
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </>
            )}

          {tab === 'preview' &&
            (artifact.language === 'svg' || artifact.language === 'image') && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setBgMode((m) =>
                      m === 'light' ? 'checker' : m === 'checker' ? 'dark' : 'light',
                    )
                  }
                  title={`Background: ${bgMode} (click to cycle)`}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(25, z - 25))}
                  title="Zoom out"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(100)}
                  title="Reset zoom"
                  className="px-1.5 py-1 rounded-md text-[11px] font-mono tabular-nums text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {zoom}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(300, z + 25))}
                  title="Zoom in"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </>
            )}

          {tab === 'preview' &&
            (isIframeKind || artifact.language === 'image') && (
              <button
                type="button"
                onClick={() => {
                  setMediaError(false);
                  setRefreshKey((k) => k + 1);
                }}
                title="Reload preview"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

          {(artifact.language === 'svg' ||
            (artifact.language === 'mermaid' && Boolean(renderedMermaidSvg))) && (
            <button
              type="button"
              disabled={exportingPng}
              onClick={handleExportPng}
              title="Export graphic as PNG"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PNG</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            title={isBinaryMedia ? 'Copy media URL' : 'Copy source'}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-[#0d0d0f] p-3 flex justify-center">
        {tab === 'source' ? (
          isBinaryMedia ? (
            <div className="w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 space-y-4">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {artifact.title}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <dt className="text-zinc-500">Type</dt>
                  <dd className="font-mono mt-1 text-zinc-900 dark:text-zinc-100">
                    {artifact.mimeType || artifact.language}
                  </dd>
                </div>
                {imgDims && (
                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <dt className="text-zinc-500">Dimensions</dt>
                    <dd className="font-mono tabular-nums mt-1 text-zinc-900 dark:text-zinc-100">
                      {imgDims.w} × {imgDims.h} px
                    </dd>
                  </div>
                )}
              </dl>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-zinc-500">
                  Media URI / Source
                </div>
                <pre className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 font-mono text-[12px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all max-h-60 overflow-auto">
                  {artifact.code.slice(0, 4000)}
                  {artifact.code.length > 4000 ? '\n…(truncated)' : ''}
                </pre>
              </div>
            </div>
          ) : (
            <div className="w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 p-4">
              <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                <code>{artifact.code}</code>
              </pre>
            </div>
          )
        ) : artifact.language === 'mermaid' ? (
          <div className="w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] flex items-center justify-center p-4">
            <MermaidDiagram
              key={`${artifact.id}-${refreshKey}-${theme}`}
              code={artifact.code}
              theme={theme}
              onSvgReady={setRenderedMermaidSvg}
            />
          </div>
        ) : artifact.language === 'svg' && !svgImgFallback ? (
          <div
            className={`w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center p-6 ${checkerClass}`}
          >
            <img
              key={`${artifact.id}-${refreshKey}`}
              src={svgDataUrl}
              alt={artifact.title}
              onError={() => setSvgImgFallback(true)}
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'center center',
              }}
              className="min-w-[180px] max-w-full max-h-full object-contain transition-transform duration-150"
            />
          </div>
        ) : isIframeKind || (artifact.language === 'svg' && svgImgFallback) ? (
          <div
            className={`h-full bg-white rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm transition-all duration-200 ${viewportWidthClass}`}
          >
            <iframe
              key={`${artifact.id}-${refreshKey}-${theme}-${bgMode}`}
              title={artifact.title}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="w-full h-full border-0 bg-white"
            />
          </div>
        ) : artifact.language === 'image' ? (
          <div
            className={`w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center p-6 ${checkerClass}`}
          >
            {!mediaError ? (
              <img
                key={`${artifact.id}-${refreshKey}`}
                src={artifact.code}
                alt={artifact.title}
                referrerPolicy="no-referrer"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) {
                    setImgDims({ w: el.naturalWidth, h: el.naturalHeight });
                  }
                }}
                onError={() => setMediaError(true)}
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'center center',
                }}
                className="max-w-full max-h-full object-contain rounded-lg transition-transform duration-150"
              />
            ) : (
              <div className="text-center space-y-3 p-6 text-zinc-500">
                <ImageIcon className="w-8 h-8 mx-auto opacity-60" />
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Image host blocked preview or failed to load
                </p>
                <p className="text-xs break-all max-w-sm">{artifact.title}</p>
                {isExternalHttpUrl && (
                  <a
                    href={artifact.code}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <span>Open original image</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        ) : artifact.language === 'audio' ? (
          <div className="w-full h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#18181b] flex flex-col items-center justify-center p-8 gap-5">
            <div className="w-14 h-14 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
              <FileAudio className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-center space-y-1 max-w-md">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {artifact.title}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Audio media preview
              </div>
            </div>
            <audio
              controls
              src={artifact.code}
              className="w-full max-w-md"
            >
              Your browser does not support audio playback.
            </audio>
          </div>
        ) : artifact.language === 'video' ? (
          <div className="w-full h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-black flex flex-col items-center justify-center p-4 gap-3">
            <video
              controls
              playsInline
              src={artifact.code}
              className="max-w-full max-h-[82vh] rounded-lg"
            >
              Your browser does not support video playback.
            </video>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <FileVideo className="w-3.5 h-3.5" />
              <span className="truncate max-w-sm">{artifact.title}</span>
            </div>
          </div>
        ) : artifact.language === 'markdown' ? (
          <div className="w-full h-full overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#18181b] p-6 sm:p-8 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            <article className="max-w-2xl mx-auto space-y-3">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={safeUrlTransform}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 pt-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className="leading-7">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="list-disc pl-6 space-y-1">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-6 space-y-1">{children}</ol>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <table className="w-full text-left border-collapse text-xs tabular-nums">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 font-semibold border-b border-zinc-200 dark:border-zinc-800">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800">
                      {children}
                    </td>
                  ),
                  code: ({ children }) => (
                    <code className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-xs">
                      {children}
                    </code>
                  ),
                }}
              >
                {artifact.code}
              </ReactMarkdown>
            </article>
          </div>
        ) : artifact.language === 'csv' ? (
          <div className="w-full h-full flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#18181b] overflow-hidden">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder="Filter rows…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {csvBody.length} rows · {csvHeader.length} cols
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {csvRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">
                  No tabular rows detected.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      {csvHeader.map((col, idx) => (
                        <th
                          key={idx}
                          className="px-3 py-2.5 font-semibold text-zinc-800 dark:text-zinc-200 whitespace-nowrap"
                        >
                          {col || `Column ${idx + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {csvBody.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                      >
                        {csvHeader.map((_, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-3 py-2 text-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                          >
                            {row[cIdx] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          /* JSON Inspector */
          <div className="w-full h-full flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#18181b] overflow-hidden">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <span
                className={`text-xs font-medium ${
                  jsonParsed?.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {jsonParsed?.ok
                  ? 'Valid JSON'
                  : `Parse error: ${jsonParsed?.error || 'Invalid JSON'}`}
              </span>
              {jsonTableData && (
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setJsonViewMode('formatted')}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${
                      jsonViewMode === 'formatted'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500'
                    }`}
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setJsonViewMode('table')}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${
                      jsonViewMode === 'table'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500'
                    }`}
                  >
                    Table ({jsonTableData.rows.length})
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {jsonParsed?.ok && jsonViewMode === 'table' && jsonTableData ? (
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      {jsonTableData.keys.map((k) => (
                        <th key={k} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {jsonTableData.rows.map((row, idx) => (
                      <tr key={idx}>
                        {jsonTableData.keys.map((k) => {
                          const cell = row[k];
                          const str =
                            cell === null || cell === undefined
                              ? ''
                              : typeof cell === 'object'
                                ? JSON.stringify(cell)
                                : String(cell);
                          return (
                            <td
                              key={k}
                              className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[220px] truncate"
                            >
                              {str}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre className="font-mono text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
                  <code>
                    {jsonParsed?.ok ? jsonParsed.formatted : artifact.code}
                  </code>
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
