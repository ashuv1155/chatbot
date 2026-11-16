import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Play, WrapText } from 'lucide-react';
import type { PreviewArtifact } from '../types/chat';
import { copyToClipboard } from '../lib/browser';

interface CodeBlockProps {
  language?: string;
  code: string;
  onPreviewArtifact?: (artifact: PreviewArtifact) => void;
}

function CodeBlock({ language, code, onPreviewArtifact }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);

  const normalizedLang = (language || '').toLowerCase();
  const canPreview =
    Boolean(onPreviewArtifact) &&
    (normalizedLang === 'html' || normalizedLang === 'svg');

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400">
        <span className="font-mono lowercase select-none">
          {language || 'code'}
        </span>
        <div className="flex items-center gap-1">
          {canPreview && (
            <button
              type="button"
              onClick={() =>
                onPreviewArtifact?.({
                  id: `${Date.now()}`,
                  language: normalizedLang as 'html' | 'svg',
                  code,
                  title:
                    normalizedLang === 'svg'
                      ? 'SVG Graphic Preview'
                      : 'HTML Live Preview',
                })
              }
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Preview</span>
            </button>
          )}
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
      <div className="overflow-x-auto p-4 text-[13.5px] leading-relaxed">
        <pre
          className={`font-mono ${
            wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
          }`}
        >
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  onPreviewArtifact?: (artifact: PreviewArtifact) => void;
}

export function MarkdownRenderer({
  content,
  onPreviewArtifact,
}: MarkdownRendererProps) {
  return (
    <div className="prose-chat text-[15px] leading-[1.7] text-zinc-800 dark:text-zinc-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 dark:text-emerald-400 underline underline-offset-2 decoration-emerald-500/40 hover:decoration-emerald-500 transition-colors"
            >
              {children}
            </a>
          ),
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
        {content}
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
