import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Maximize2,
  Play,
  WrapText,
} from 'lucide-react';
import type { PreviewArtifact, PreviewArtifactKind, SearchSource } from '../types/chat';
import { copyToClipboard, downloadUrl } from '../lib/browser';
import {
  buildPreviewSrcDoc,
  detectMediaUrlKind,
  getPreviewLabel,
  mapLanguageToPreviewKind,
  parseCsvRows,
  preprocessMarkdownCitations,
  preprocessMarkdownMedia,
  svgToDataUrl,
} from '../lib/previews';
import { MermaidDiagram } from './MermaidDiagram';

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

interface CodeBlockProps {
  language?: string;
  code: string;
  theme?: 'dark' | 'light';
  onPreviewArtifact?: (artifact: PreviewArtifact) => void;
}

function CodeBlock({
  language,
  code,
  theme = 'dark',
  onPreviewArtifact,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [svgImgFallback, setSvgImgFallback] = useState(false);

  const previewKind: PreviewArtifactKind | null = mapLanguageToPreviewKind(
    language,
    code,
  );

  const isAutoVisualDefault =
    (previewKind === 'svg' && /<svg[\s>]/i.test(code) && /<\/svg>/i.test(code)) ||
    (previewKind === 'mermaid' && code.trim().length > 8);

  const [inlineMode, setInlineMode] = useState<'visual' | 'code'>(
    isAutoVisualDefault ? 'visual' : 'code',
  );
  const manualToggleRef = useRef(false);

  useEffect(() => {
    setSvgImgFallback(false);
  }, [code]);

  useEffect(() => {
    if (isAutoVisualDefault && !manualToggleRef.current) {
      setInlineMode('visual');
    }
  }, [isAutoVisualDefault]);

  const inlineSrcDoc = useMemo(() => {
    if (inlineMode !== 'visual' || !previewKind) return '';
    if (
      previewKind === 'html' ||
      previewKind === 'react' ||
      previewKind === 'css' ||
      previewKind === 'javascript' ||
      (previewKind === 'svg' && svgImgFallback)
    ) {
      return buildPreviewSrcDoc(
        {
          id: 'inline',
          language: previewKind,
          code,
          title: getPreviewLabel(previewKind, language),
          rawLanguage: language,
        },
        theme,
        'light',
      );
    }
    return '';
  }, [inlineMode, previewKind, code, language, theme, svgImgFallback]);

  const inlineSvgUrl = useMemo(() => {
    if (previewKind !== 'svg') return '';
    return svgToDataUrl(code);
  }, [previewKind, code]);

  const inlineCsvRows = useMemo(() => {
    if (inlineMode !== 'visual' || previewKind !== 'csv') return [];
    return parseCsvRows(code);
  }, [inlineMode, previewKind, code]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const openFullPreview = () => {
    if (!onPreviewArtifact) return;
    const resolvedKind: PreviewArtifactKind = previewKind || 'code';
    onPreviewArtifact({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      language: resolvedKind,
      code,
      title: getPreviewLabel(resolvedKind, language),
      rawLanguage: language || (resolvedKind === 'code' ? 'text' : resolvedKind),
      lineCount: code.split(/\r?\n/).length,
    });
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400 gap-2">
        <span className="font-mono lowercase select-none truncate">
          {language || previewKind || 'code'}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {previewKind && (
            <button
              type="button"
              onClick={() => {
                manualToggleRef.current = true;
                setInlineMode((m) => (m === 'visual' ? 'code' : 'visual'));
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                inlineMode === 'visual'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {inlineMode === 'visual' ? (
                <>
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Code</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Visual</span>
                </>
              )}
            </button>
          )}

          {onPreviewArtifact && (
            <button
              type="button"
              onClick={openFullPreview}
              title={
                previewKind
                  ? 'Open in Code Preview workspace'
                  : 'Inspect in Code Preview workspace'
              }
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0"
            >
              {previewKind ? (
                <Play className="w-3 h-3 fill-current" />
              ) : (
                <Maximize2 className="w-3 h-3" />
              )}
              <span>{previewKind ? 'Preview' : 'Inspect'}</span>
            </button>
          )}

          {inlineMode === 'code' && (
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              title={wrap ? 'Disable word wrap' : 'Enable word wrap'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
                wrap
                  ? 'text-zinc-100 bg-zinc-800'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wrap</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-zinc-800/70 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {inlineMode === 'visual' && previewKind ? (
        previewKind === 'svg' && !svgImgFallback ? (
          <div className="bg-white p-5 flex items-center justify-center min-h-[160px] max-h-[380px] overflow-auto">
            <img
              src={inlineSvgUrl}
              alt="Generated SVG graphic"
              onError={() => setSvgImgFallback(true)}
              className="min-w-[140px] max-w-full max-h-[320px] object-contain"
            />
          </div>
        ) : previewKind === 'mermaid' ? (
          <div className="bg-white dark:bg-[#141416] min-h-[140px]">
            <MermaidDiagram code={code} theme={theme} />
          </div>
        ) : previewKind === 'csv' ? (
          <div className="bg-white dark:bg-[#141416] text-zinc-800 dark:text-zinc-200 max-h-[320px] overflow-auto">
            {inlineCsvRows.length > 0 ? (
              <table className="w-full text-left border-collapse text-xs tabular-nums">
                <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    {inlineCsvRows[0].map((col, idx) => (
                      <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">
                        {col || `Col ${idx + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  {inlineCsvRows.slice(1, 30).map((row, rIdx) => (
                    <tr key={rIdx}>
                      {inlineCsvRows[0].map((_, cIdx) => (
                        <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap">
                          {row[cIdx] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-4 text-xs text-zinc-500">No CSV rows parsed.</div>
            )}
          </div>
        ) : previewKind === 'markdown' ? (
          <div className="bg-white dark:bg-[#18181b] text-zinc-800 dark:text-zinc-200 p-5 max-h-[340px] overflow-auto text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform}>
              {code}
            </ReactMarkdown>
          </div>
        ) : previewKind === 'json' ? (
          <div className="bg-zinc-950 text-zinc-100 p-4 max-h-[320px] overflow-auto">
            <pre className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">
              <code>
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(code), null, 2);
                  } catch {
                    return code;
                  }
                })()}
              </code>
            </pre>
          </div>
        ) : (
          <div className="bg-white">
            <iframe
              title={getPreviewLabel(previewKind)}
              sandbox="allow-scripts"
              srcDoc={inlineSrcDoc}
              className="w-full h-[320px] border-0 block bg-white"
            />
          </div>
        )
      ) : (
        <div className="overflow-x-auto p-4 text-[13.5px] leading-relaxed">
          <pre
            className={`font-mono ${
              wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

interface MarkdownImageCardProps {
  src: string;
  alt: string;
  onPreviewArtifact?: (artifact: PreviewArtifact) => void;
}

function MarkdownImageCard({
  src,
  alt,
  onPreviewArtifact,
}: MarkdownImageCardProps) {
  const [failed, setFailed] = useState(false);

  const handleExpand = () => {
    if (!onPreviewArtifact) return;
    onPreviewArtifact({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      language: 'image',
      code: src,
      title: alt || 'Image Preview',
    });
  };

  if (failed) {
    return (
      <span className="my-3 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="inline-flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="truncate">{alt || src}</span>
        </span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline shrink-0"
        >
          <span>Open</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </span>
    );
  }

  return (
    <span className="my-3 block overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 max-w-xl">
      <button
        type="button"
        onClick={handleExpand}
        title="Click to inspect full image"
        className="block w-full text-left cursor-zoom-in group/img relative"
      >
        <img
          src={src}
          alt={alt || 'Generated media'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full max-h-[380px] object-contain bg-white dark:bg-[#141416]"
        />
      </button>
      <span className="flex items-center justify-between gap-2 px-3 py-2 border-t border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="truncate">{alt || 'Image'}</span>
        <span className="flex items-center gap-1 shrink-0">
          {onPreviewArtifact && (
            <button
              type="button"
              onClick={handleExpand}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadUrl(alt ? `${alt}.png` : 'image.png', src)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors"
          >
            <Download className="w-3 h-3" />
          </button>
        </span>
      </span>
    </span>
  );
}

interface MarkdownRendererProps {
  content: string;
  theme?: 'dark' | 'light';
  sources?: SearchSource[];
  onPreviewArtifact?: (artifact: PreviewArtifact) => void;
}

export function MarkdownRenderer({
  content,
  theme = 'dark',
  sources,
  onPreviewArtifact,
}: MarkdownRendererProps) {
  const preparedContent = useMemo(
    () => preprocessMarkdownMedia(preprocessMarkdownCitations(content, sources)),
    [content, sources],
  );

  return (
    <div className="prose-chat text-[15px] leading-[1.7] text-zinc-800 dark:text-zinc-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrlTransform}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-6 mb-3 tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-5 mb-2.5 tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-4 mb-2">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="mb-3.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-3.5 space-y-1.5 marker:text-zinc-400 dark:marker:text-zinc-500">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-3.5 space-y-1.5 marker:text-zinc-500 dark:marker:text-zinc-400">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-[1.65]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3.5 pl-4 border-l border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 italic">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-5 border-zinc-200 dark:border-zinc-800" />
          ),
          img: ({ src, alt }) => {
            if (!src) return null;
            return (
              <MarkdownImageCard
                src={src}
                alt={alt || ''}
                onPreviewArtifact={onPreviewArtifact}
              />
            );
          },
          a: ({ href, title, children }) => {
            if (title?.startsWith('cite:')) {
              const cleanTitle = title.slice(5).trim();
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={cleanTitle}
                  className="inline-flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1 py-0.5 rounded mx-0.5 no-underline align-baseline transition-colors"
                >
                  [{children}]
                </a>
              );
            }

            const mediaKind = href ? detectMediaUrlKind(href) : null;
            if (href && mediaKind && onPreviewArtifact) {
              const label = extractText(children) || href;
              if (mediaKind === 'image') {
                return (
                  <MarkdownImageCard
                    src={href}
                    alt={label}
                    onPreviewArtifact={onPreviewArtifact}
                  />
                );
              }
              return (
                <span className="inline-flex items-center gap-2 flex-wrap">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 dark:text-emerald-400 underline underline-offset-2 decoration-emerald-500/40 hover:decoration-emerald-500 transition-colors"
                  >
                    {children}
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewArtifact({
                        id: `${Date.now()}`,
                        language: mediaKind,
                        code: href,
                        title: label,
                      })
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Preview</span>
                  </button>
                </span>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 dark:text-emerald-400 underline underline-offset-2 decoration-emerald-500/40 hover:decoration-emerald-500 transition-colors"
              >
                {children}
              </a>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              {children}
            </strong>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left border-collapse text-sm tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-zinc-50 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 font-semibold text-xs tracking-wide">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2.5 border-t border-zinc-200 dark:border-zinc-800/80 text-zinc-700 dark:text-zinc-300">
              {children}
            </td>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const match = /language-([^\s]+)/.exec(className || '');
            const text = extractText(children).replace(/\n$/, '');
            const isBlock = Boolean(match) || text.includes('\n');

            if (isBlock) {
              return (
                <CodeBlock
                  language={match?.[1]}
                  code={text}
                  theme={theme}
                  onPreviewArtifact={onPreviewArtifact}
                />
              );
            }

            return (
              <code
                className="px-1.5 py-0.5 mx-0.5 rounded bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 text-[13.5px] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {preparedContent}
      </ReactMarkdown>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return '';
}
