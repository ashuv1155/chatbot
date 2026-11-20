import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  PanelRightOpen,
} from 'lucide-react';
import type { PreviewArtifact } from '../types/chat';
import { copyToClipboard, downloadFile } from '../lib/browser';
import {
  buildPreviewSrcDoc,
  getPreviewFileExtension,
  getPreviewLabel,
  isLivePreviewableKind,
  parseCsvRows,
  svgToDataUrl,
} from '../lib/previews';
import { MermaidDiagram } from './MermaidDiagram';

interface CodePreviewSectionProps {
  artifacts: PreviewArtifact[];
  theme?: 'dark' | 'light';
  isStreaming?: boolean;
  onOpenWorkspace: (artifact: PreviewArtifact) => void;
}

export function CodePreviewSection({
  artifacts,
  theme = 'dark',
  isStreaming = false,
  onOpenWorkspace,
}: CodePreviewSectionProps) {
  const defaultIndex = useMemo(() => {
    const liveIdx = artifacts.findIndex((a) => isLivePreviewableKind(a.language));
    return liveIdx >= 0 ? liveIdx : 0;
  }, [artifacts]);

  const [selectedIdx, setSelectedIdx] = useState(defaultIndex);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [svgImgFallback, setSvgImgFallback] = useState(false);

  const safeIdx = selectedIdx < artifacts.length ? selectedIdx : defaultIndex;
  const active = artifacts[safeIdx] || artifacts[0];
  const canLivePreview = active ? isLivePreviewableKind(active.language) : false;

  const [viewMode, setViewMode] = useState<'preview' | 'code'>(() =>
    canLivePreview ? 'preview' : 'code',
  );

  useEffect(() => {
    setSvgImgFallback(false);
    setViewMode(canLivePreview ? 'preview' : 'code');
  }, [active?.id, canLivePreview]);

  const iframeSrcDoc = useMemo(() => {
    if (!active || viewMode !== 'preview') return '';
    if (
      active.language === 'html' ||
      active.language === 'react' ||
      active.language === 'css' ||
      active.language === 'javascript' ||
      (active.language === 'svg' && svgImgFallback)
    ) {
      return buildPreviewSrcDoc(active, theme, 'light');
    }
    return '';
  }, [active, viewMode, theme, svgImgFallback]);

  const svgUrl = useMemo(() => {
    if (!active || active.language !== 'svg') return '';
    return svgToDataUrl(active.code);
  }, [active]);

  const csvRows = useMemo(() => {
    if (!active || active.language !== 'csv' || viewMode !== 'preview') return [];
    return parseCsvRows(active.code);
  }, [active, viewMode]);

  const codeLines = useMemo(
    () => (active ? active.code.split(/\r?\n/) : []),
    [active],
  );

  if (!active || artifacts.length === 0) return null;

  const handleCopy = async () => {
    const ok = await copyToClipboard(active.code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    const ext = getPreviewFileExtension(
      active.language,
      active.filename,
      active.rawLanguage,
    );
    const base = active.filename
      ? active.filename.replace(/\.[^.]+$/, '')
      : `ashutosh-gpt-${safeIdx + 1}`;
    downloadFile(`${base}.${ext}`, active.code, 'text/plain;charset=utf-8');
  };

  const activeTitle =
    active.filename || getPreviewLabel(active.language, active.rawLanguage);

  return (
    <section
      aria-label="Generated code preview section"
      className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 overflow-hidden no-print"
    >
      {/* Dedicated Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/80">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-2 text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          )}
          <Code2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            Code Preview
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
            · {artifacts.length}{' '}
            {artifacts.length === 1 ? 'section' : 'sections'} ·{' '}
            {active.lineCount ?? codeLines.length} lines
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {canLivePreview && (
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/80 dark:border-zinc-700/80">
              <button
                type="button"
                onClick={() => {
                  setExpanded(true);
                  setViewMode('preview');
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'preview'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Preview</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(true);
                  setViewMode('code');
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'code'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            title="Copy code"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700/80 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">
                  Copied
                </span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="Download file"
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onOpenWorkspace(active)}
            title="Open side-by-side Code & Preview workspace"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[11px] font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            <span>Open Split View</span>
          </button>
        </div>
      </div>

      {/* File / Code Block Selector Tabs */}
      {artifacts.length > 1 && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 overflow-x-auto">
          {artifacts.map((item, idx) => {
            const isSelected = idx === safeIdx;
            const label =
              item.filename || getPreviewLabel(item.language, item.rawLanguage);
            const live = isLivePreviewableKind(item.language);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedIdx(idx);
                  setExpanded(true);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'border-emerald-500/60 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'border-zinc-200/80 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-800/60'
                }`}
              >
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  #{idx + 1}
                </span>
                <span className="truncate max-w-[150px]">{label}</span>
                {live && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                    title="Live preview available"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      {expanded && (
        <div className="bg-white dark:bg-[#141416]">
          <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/80 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {activeTitle}
            </span>
            <span className="font-mono lowercase">
              {active.rawLanguage || active.language}
              {isStreaming ? ' · streaming' : ''}
            </span>
          </div>

          {viewMode === 'preview' && canLivePreview ? (
            active.language === 'mermaid' ? (
              <div className="p-4 min-h-[160px] max-h-[340px] overflow-auto">
                <MermaidDiagram code={active.code} theme={theme} />
              </div>
            ) : active.language === 'svg' && !svgImgFallback ? (
              <div className="bg-white p-5 flex items-center justify-center min-h-[160px] max-h-[340px] overflow-auto">
                <img
                  src={svgUrl}
                  alt={activeTitle}
                  onError={() => setSvgImgFallback(true)}
                  className="min-w-[140px] max-w-full max-h-[300px] object-contain"
                />
              </div>
            ) : active.language === 'csv' ? (
              <div className="max-h-[300px] overflow-auto">
                {csvRows.length > 0 ? (
                  <table className="w-full text-left border-collapse text-xs tabular-nums">
                    <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                      <tr>
                        {csvRows[0].map((col, idx) => (
                          <th
                            key={idx}
                            className="px-3 py-2 font-semibold whitespace-nowrap"
                          >
                            {col || `Col ${idx + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                      {csvRows.slice(1, 25).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {csvRows[0].map((_, cIdx) => (
                            <td
                              key={cIdx}
                              className="px-3 py-1.5 whitespace-nowrap"
                            >
                              {row[cIdx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-4 text-xs text-zinc-500">
                    No tabular rows detected.
                  </div>
                )}
              </div>
            ) : active.language === 'json' ? (
              <div className="bg-zinc-950 text-zinc-100 p-4 max-h-[300px] overflow-auto">
                <pre className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">
                  <code>
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(active.code), null, 2);
                      } catch {
                        return active.code;
                      }
                    })()}
                  </code>
                </pre>
              </div>
            ) : active.language === 'markdown' ? (
              <div className="p-5 max-h-[320px] overflow-auto text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {active.code}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="bg-white">
                <iframe
                  title={activeTitle}
                  sandbox="allow-scripts"
                  srcDoc={iframeSrcDoc}
                  className="w-full h-[300px] border-0 block bg-white"
                />
              </div>
            )
          ) : (
            <div className="bg-zinc-950 text-zinc-100 max-h-[300px] overflow-auto p-3 font-mono text-[12.5px] leading-relaxed">
              <table className="w-full border-collapse">
                <tbody>
                  {codeLines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/60">
                      <td className="select-none pr-3 text-right align-top text-[11px] text-zinc-600 tabular-nums w-8">
                        {idx + 1}
                      </td>
                      <td className="align-top text-zinc-100 whitespace-pre">
                        {line || ' '}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
