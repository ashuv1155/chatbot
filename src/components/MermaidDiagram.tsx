import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  code: string;
  theme?: 'dark' | 'light';
  className?: string;
  onSvgReady?: (svg: string) => void;
}

export function MermaidDiagram({
  code,
  theme = 'dark',
  className = '',
  onSvgReady,
}: MermaidDiagramProps) {
  const reactId = useId().replace(/[:]/g, '_');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg('');
      setError(null);
      return;
    }

    const renderId = `mmd_${reactId.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`;

    const timer = setTimeout(async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'loose',
        });
        const result = await mermaid.render(renderId, trimmed);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
          onSvgReady?.(result.svg);
        }
      } catch (err) {
        document.getElementById(`d${renderId}`)?.remove();
        document.getElementById(renderId)?.remove();
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Unable to parse Mermaid diagram.',
          );
        }
      }
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, theme, reactId, onSvgReady]);

  if (error) {
    return (
      <div className="p-4 text-xs font-mono text-rose-700 dark:text-rose-300 bg-rose-50/70 dark:bg-rose-950/30 whitespace-pre-wrap">
        Mermaid syntax note: {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className={`w-full overflow-auto flex items-center justify-center p-4 [&_svg]:max-w-full [&_svg]:h-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
