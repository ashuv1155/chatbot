import { transform as sucraseTransform } from 'sucrase';
import type {
  Attachment,
  PreviewArtifact,
  PreviewArtifactKind,
  SearchSource,
} from '../types/chat';

export function mapLanguageToPreviewKind(
  lang?: string,
  code?: string,
): PreviewArtifactKind | null {
  const normalized = (lang || '').trim().toLowerCase();
  if (normalized === 'html' || normalized === 'htm') return 'html';
  if (normalized === 'svg') return 'svg';
  if (
    normalized === 'jsx' ||
    normalized === 'tsx' ||
    normalized === 'react'
  ) {
    return 'react';
  }
  if (normalized === 'mermaid' || normalized === 'mmd') return 'mermaid';
  if (normalized === 'markdown' || normalized === 'md') return 'markdown';
  if (normalized === 'csv' || normalized === 'tsv') return 'csv';
  if (normalized === 'json' || normalized === 'jsonc') return 'json';
  if (normalized === 'css' || normalized === 'scss') return 'css';
  if (
    normalized === 'js' ||
    normalized === 'javascript' ||
    normalized === 'mjs' ||
    normalized === 'ts' ||
    normalized === 'typescript'
  ) {
    return 'javascript';
  }

  // Smart content-based fallback for xml / plain / unlabeled code blocks
  if (
    code &&
    (normalized === '' ||
      normalized === 'xml' ||
      normalized === 'txt' ||
      normalized === 'text' ||
      normalized === 'plaintext')
  ) {
    const trimmed = code.trim();
    if (/<svg[\s>]/i.test(trimmed) && /<\/svg>/i.test(trimmed)) {
      return 'svg';
    }
    if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(trimmed)) {
      return 'html';
    }
    if (
      /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|gitGraph|timeline)\b/.test(
        trimmed,
      )
    ) {
      return 'mermaid';
    }
    if (
      /(?:export\s+default\s+function|import\s+React\b)/.test(trimmed) &&
      /<[A-Za-z][^>]*>/.test(trimmed)
    ) {
      return 'react';
    }
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Not valid JSON
      }
    }
  }

  return null;
}

const CODE_LANG_EXT_MAP: Record<string, string> = {
  python: 'py',
  py: 'py',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'js',
  js: 'js',
  tsx: 'tsx',
  jsx: 'jsx',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  go: 'go',
  golang: 'go',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  csharp: 'cs',
  cs: 'cs',
  'c#': 'cs',
  php: 'php',
  ruby: 'rb',
  rb: 'rb',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  r: 'r',
  dart: 'dart',
  lua: 'lua',
  perl: 'pl',
  ini: 'ini',
  env: 'env',
};

const CODE_LANG_LABEL_MAP: Record<string, string> = {
  py: 'Python',
  python: 'Python',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Bash',
  shell: 'Shell',
  zsh: 'Zsh',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  go: 'Go',
  golang: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  kt: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  'c#': 'C#',
  php: 'PHP',
  rb: 'Ruby',
  ruby: 'Ruby',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  dockerfile: 'Dockerfile',
  docker: 'Docker',
  graphql: 'GraphQL',
  prisma: 'Prisma',
  dart: 'Dart',
  r: 'R',
};

export function isLivePreviewableKind(kind: PreviewArtifactKind): boolean {
  return kind !== 'code';
}

export function getPreviewLabel(
  kind: PreviewArtifactKind,
  rawLanguage?: string,
): string {
  switch (kind) {
    case 'html':
      return 'HTML Preview';
    case 'svg':
      return 'SVG Vector';
    case 'react':
      return 'React Component';
    case 'mermaid':
      return 'Mermaid Diagram';
    case 'markdown':
      return 'Markdown Document';
    case 'csv':
      return 'Data Table';
    case 'json':
      return 'JSON Inspector';
    case 'css':
      return 'CSS Stylesheet';
    case 'javascript':
      return rawLanguage && /^(ts|typescript)$/i.test(rawLanguage)
        ? 'TypeScript Runner'
        : 'JS / TS Runner';
    case 'code': {
      const clean = (rawLanguage || '').trim().toLowerCase();
      if (!clean) return 'Code Snippet';
      const nice =
        CODE_LANG_LABEL_MAP[clean] ||
        clean.charAt(0).toUpperCase() + clean.slice(1);
      return `${nice} Code`;
    }
    case 'image':
      return 'Image Preview';
    case 'audio':
      return 'Audio Player';
    case 'video':
      return 'Video Player';
  }
}

export function getPreviewFileExtension(
  kind: PreviewArtifactKind,
  filename?: string,
  rawLanguage?: string,
): string {
  if (filename && filename.includes('.')) {
    const ext = filename.split('.').pop();
    if (ext && /^[a-z0-9]{1,10}$/i.test(ext)) return ext.toLowerCase();
  }
  switch (kind) {
    case 'html':
      return 'html';
    case 'svg':
      return 'svg';
    case 'react':
      return 'tsx';
    case 'mermaid':
      return 'mmd';
    case 'markdown':
      return 'md';
    case 'csv':
      return 'csv';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'javascript':
      return rawLanguage && /^(ts|typescript)$/i.test(rawLanguage)
        ? 'ts'
        : 'js';
    case 'code': {
      const clean = (rawLanguage || '').trim().toLowerCase();
      return CODE_LANG_EXT_MAP[clean] || 'txt';
    }
    case 'image':
      return 'png';
    case 'audio':
      return 'mp3';
    case 'video':
      return 'mp4';
  }
}

function extractFilenameHint(code: string): string | undefined {
  const firstLines = code.split(/\r?\n/).slice(0, 3);
  for (const line of firstLines) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /^(?:\/\/|#|\/\*|<!--|--)\s*(?:file\s*:\s*)?([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,10})\s*(?:\*\/|-->)?$/i,
    );
    if (match?.[1]) {
      const candidate = match[1].split('/').pop() || match[1];
      if (candidate.length <= 48) return candidate;
    }
  }
  return undefined;
}

/**
 * Extracts completed fenced code blocks from an assistant markdown response into
 * structured PreviewArtifact items so Ashutosh GPT can present dedicated Code Preview sections.
 */
export function extractCodeArtifactsFromMarkdown(
  markdown: string,
  messageId = 'msg',
): PreviewArtifact[] {
  if (!markdown) return [];
  const prepared = preprocessMarkdownMedia(markdown);
  const artifacts: PreviewArtifact[] = [];
  const fenceRegex = /```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = fenceRegex.exec(prepared)) !== null) {
    const rawLanguage = (match[1] || '').trim().toLowerCase();
    const code = (match[2] || '').replace(/\n$/, '');
    if (!code.trim()) continue;

    // Skip trivial 1-line shell installs unless it's multi-line or explicitly previewable
    const mapped = mapLanguageToPreviewKind(rawLanguage, code);
    const kind: PreviewArtifactKind = mapped || 'code';
    const lineCount = code.split(/\r?\n/).length;

    if (
      kind === 'code' &&
      lineCount === 1 &&
      code.trim().length < 48 &&
      /^(?:bash|sh|shell|zsh|txt|text|plaintext|)$/.test(rawLanguage)
    ) {
      continue;
    }

    idx += 1;
    const filename = extractFilenameHint(code);
    const label = getPreviewLabel(kind, rawLanguage);
    const title = filename || label;

    artifacts.push({
      id: `${messageId}-code-${idx}`,
      language: kind,
      code,
      title,
      filename,
      rawLanguage: rawLanguage || (kind === 'code' ? 'text' : kind),
      lineCount,
      messageId,
      index: idx,
    });
  }

  return artifacts;
}

/**
 * Detects whether a user prompt asks Ashutosh GPT to generate, write, build,
 * or design code, UI components, scripts, diagrams, or web apps.
 */
export function isCodeGenerationPrompt(prompt: string): boolean {
  const q = (prompt || '').trim().toLowerCase();
  if (!q) return false;

  const hasActionVerb =
    /\b(?:generate|write|create|build|make|implement|code|develop|design|scaffold|refactor|convert|fix|debug|program|give me)\b/.test(
      q,
    );
  const hasCodeTarget =
    /\b(?:code|script|program|function|class|component|widget|app|application|website|webpage|landing page|dashboard|form|navbar|modal|card|table|chart|diagram|flowchart|svg|logo|icon|html|css|scss|javascript|js|typescript|ts|react|tsx|jsx|python|sql|bash|shell|api|endpoint|regex|algorithm|shader|canvas|calculator|timer|game|todo|portfolio)\b/.test(
      q,
    );

  if (hasActionVerb && hasCodeTarget) return true;
  if (/\b(?:in|using)\s+(?:html|css|js|javascript|ts|typescript|react|tsx|python|sql|mermaid|svg)\b/.test(q)) {
    return true;
  }
  return false;
}

export function attachmentToPreviewArtifact(
  att: Attachment,
): PreviewArtifact | null {
  if (att.kind === 'image' && att.previewUrl) {
    if (att.mimeType === 'image/svg+xml' && att.content.trim()) {
      return {
        id: att.id,
        language: 'svg',
        code: att.content,
        title: att.name,
        mimeType: att.mimeType,
        filename: att.name,
      };
    }
    return {
      id: att.id,
      language: 'image',
      code: att.previewUrl,
      title: att.name,
      mimeType: att.mimeType,
      filename: att.name,
    };
  }
  if (att.kind === 'audio' && att.previewUrl) {
    return {
      id: att.id,
      language: 'audio',
      code: att.previewUrl,
      title: att.name,
      mimeType: att.mimeType,
      filename: att.name,
    };
  }
  if (att.kind === 'video' && att.previewUrl) {
    return {
      id: att.id,
      language: 'video',
      code: att.previewUrl,
      title: att.name,
      mimeType: att.mimeType,
      filename: att.name,
    };
  }

  const ext = att.name.split('.').pop()?.toLowerCase();
  const kind = mapLanguageToPreviewKind(ext, att.content);
  if (kind && att.content) {
    return {
      id: att.id,
      language: kind,
      code: att.content,
      title: att.name,
      filename: att.name,
    };
  }
  return null;
}

export function detectMediaUrlKind(
  url: string,
): 'image' | 'audio' | 'video' | null {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(clean) || /^data:image\//i.test(url)) {
    return 'image';
  }
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(clean) || /^data:audio\//i.test(url)) {
    return 'audio';
  }
  if (/\.(mp4|webm|mov|ogv|m4v)$/.test(clean) || /^data:video\//i.test(url)) {
    return 'video';
  }
  return null;
}

/**
 * Wraps standalone raw <svg>...</svg> blocks that appear outside markdown code
 * fences into ```svg fenced code blocks so they render as rich inline SVG visuals.
 */
export function preprocessMarkdownMedia(markdown: string): string {
  if (!markdown || !markdown.includes('<svg')) return markdown;
  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(<svg\b[^>]*>[\s\S]*?<\/svg>)/gi,
        '\n```svg\n$1\n```\n',
      );
    })
    .join('');
}

/**
 * Converts standalone [1], [2], or [1, 2] citation markers into clickable
 * markdown links when live web sources are attached to the message.
 */
export function preprocessMarkdownCitations(
  markdown: string,
  sources?: SearchSource[],
): string {
  if (!markdown || !sources || sources.length === 0) return markdown;
  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(?<![A-Za-z0-9_\\])\[(\d+(?:\s*,\s*\d+)*)\](?!\s*[(\[:])/g,
        (full, group: string) => {
          const nums = group
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length);
          if (nums.length === 0) return full;
          return nums
            .map((n) => {
              const src = sources[n - 1];
              const safeTitle = `${src.title} · ${src.domain}`
                .replace(/"/g, "'")
                .replace(/\s+/g, ' ')
                .trim();
              return `[${n}](${src.url} "cite:${safeTitle}")`;
            })
            .join('');
        },
      );
    })
    .join('');
}

/**
 * Ensures SVG markup has valid xmlns and sensible sizing when rendered in an
 * <img> data URI or iframe canvas.
 */
export function normalizeSvgMarkup(svgCode: string): string {
  const match = svgCode.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i);
  let svg = match ? match[0] : svgCode.trim();
  if (!/xmlns=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const openTagMatch = svg.match(/^<svg\b([^>]*)>/i);
  if (openTagMatch) {
    const attrs = openTagMatch[1];
    const hasWidth = /\bwidth\s*=/i.test(attrs);
    const hasHeight = /\bheight\s*=/i.test(attrs);
    const viewBoxMatch = attrs.match(
      /\bviewBox\s*=\s*["']\s*[-+]?\d*\.?\d+[\s,]+[-+]?\d*\.?\d+[\s,]+(\d*\.?\d+)[\s,]+(\d*\.?\d+)\s*["']/i,
    );
    if ((!hasWidth || !hasHeight) && viewBoxMatch) {
      const vbW = Number(viewBoxMatch[1]);
      const vbH = Number(viewBoxMatch[2]);
      if (vbW > 0 && vbH > 0) {
        const addAttrs = `${!hasWidth ? ` width="${vbW}"` : ''}${!hasHeight ? ` height="${vbH}"` : ''}`;
        svg = svg.replace(/^<svg\b/i, `<svg${addAttrs}`);
      }
    }
  }
  return svg;
}

export function svgToDataUrl(svgCode: string): string {
  const normalized = normalizeSvgMarkup(svgCode);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
}

export function parseCsvRows(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const firstLine = trimmed.split(/\r?\n/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter =
    tabCount > commaCount && tabCount >= semiCount
      ? '\t'
      : semiCount > commaCount
        ? ';'
        : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.length > 0));
}

function escapeJsonForScript(str: string): string {
  return JSON.stringify(str).replace(/<\/script/gi, '<\\/script');
}

function getBackgroundCss(bgMode: 'light' | 'dark' | 'checker'): string {
  if (bgMode === 'dark') {
    return 'background:#141416;color:#f4f4f5;';
  }
  if (bgMode === 'checker') {
    return 'background-color:#ffffff;background-image:linear-gradient(45deg,#ececf0 25%,transparent 25%),linear-gradient(-45deg,#ececf0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ececf0 75%),linear-gradient(-45deg,transparent 75%,#ececf0 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;color:#18181b;';
  }
  return 'background:#ffffff;color:#18181b;';
}

function compileReactToBrowserJs(rawCode: string): {
  compiledJs: string;
  targetName: string | null;
  error?: string;
} {
  try {
    const lucideImports: string[] = [];
    let code = rawCode.replace(
      /^\s*import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];?\s*$/gm,
      (_full, names: string) => {
        const cleaned = names
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        lucideImports.push(...cleaned);
        return '';
      },
    );

    code = code
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, 'function $1')
      .replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/g, 'class $1')
      .replace(/export\s+default\s+/g, 'const __DefaultExport__ = ')
      .replace(/export\s+(const|let|var|function|class|type|interface)\s+/g, '$1 ');

    const fnMatch =
      rawCode.match(/export\s+default\s+(?:function|class)\s+([A-Za-z0-9_]+)/) ||
      rawCode.match(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)\s*(?:\(|=|\{)/);

    const hasDefaultAssignment =
      code.includes('__DefaultExport__') ||
      /export\s+default\s+(?!function|class)/.test(rawCode);
    const targetName = hasDefaultAssignment
      ? '__DefaultExport__'
      : fnMatch
        ? fnMatch[1]
        : null;

    const lucideDecls =
      lucideImports.length > 0
        ? `const { ${lucideImports.join(', ')} } = __LucideProxy;`
        : '';

    // If user wrote bare JSX without any wrapping component
    if (!targetName && /^\s*</.test(code.trim())) {
      code = `function App() { return (\n${code}\n); }`;
    }

    const combinedTsx = [
      'const { useState, useEffect, useMemo, useRef, useCallback, useReducer, useContext, createContext, Fragment } = React;',
      lucideDecls,
      code,
    ]
      .filter(Boolean)
      .join('\n');

    const result = sucraseTransform(combinedTsx, {
      transforms: ['jsx', 'typescript'],
      production: true,
    });

    const resolvedTarget = targetName || (!fnMatch ? 'App' : null);

    return {
      compiledJs: result.code,
      targetName: resolvedTarget,
    };
  } catch (err) {
    return {
      compiledJs: '',
      targetName: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildPreviewSrcDoc(
  artifact: PreviewArtifact,
  theme: 'dark' | 'light',
  bgMode: 'light' | 'dark' | 'checker' = 'light',
): string {
  if (artifact.language === 'svg') {
    const bgCss = getBackgroundCss(bgMode);
    const svg = normalizeSvgMarkup(artifact.code);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 20px;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      ${bgCss}
      font-family: system-ui, -apple-system, sans-serif;
    }
    svg {
      display: block;
      max-width: 100%;
      max-height: calc(100vh - 40px);
      min-width: 120px;
      height: auto;
    }
  </style>
</head>
<body>${svg}</body>
</html>`;
  }

  if (artifact.language === 'html') {
    const errorHook = `<script>
window.addEventListener('error', function(e) {
  var box = document.getElementById('__ashutosh_err__');
  if (!box) {
    box = document.createElement('div');
    box.id = '__ashutosh_err__';
    box.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;z-index:99999;background:#450a0a;color:#fecaca;border:1px solid #991b1b;border-radius:8px;padding:10px 12px;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;';
    document.body && document.body.appendChild(box);
  }
  box.textContent = 'Runtime error: ' + (e.message || e.error || 'Unknown error');
});
</script>`;
    const usesTailwind =
      /\bclass(?:Name)?=["'][^"']*\b(?:flex|grid|bg-|text-|p-|px-|py-|m-|mx-|my-|rounded|border-|shadow-|gap-|space-[xy]-)/.test(
        artifact.code,
      ) && !/tailwindcss/i.test(artifact.code);
    const tailwindTag = usesTailwind
      ? '<script src="https://cdn.tailwindcss.com"></script>'
      : '';

    const hasHtmlTag = /<html[\s>]/i.test(artifact.code);
    if (hasHtmlTag) {
      let htmlDoc = artifact.code;
      if (tailwindTag && /<\/head>/i.test(htmlDoc)) {
        htmlDoc = htmlDoc.replace(/<\/head>/i, `${tailwindTag}\n</head>`);
      }
      return /<\/body>/i.test(htmlDoc)
        ? htmlDoc.replace(/<\/body>/i, `${errorHook}</body>`)
        : `${htmlDoc}${errorHook}`;
    }
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${tailwindTag}
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; background: #ffffff; color: #18181b; }
  </style>
</head>
<body>
${artifact.code}
${errorHook}
</body>
</html>`;
  }

  if (artifact.language === 'react') {
    const isDark = theme === 'dark';
    const compiled = compileReactToBrowserJs(artifact.code);
    if (compiled.error) {
      return `<!doctype html>
<html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;background:${isDark ? '#141416' : '#fff'};color:#f43f5e;">
<pre style="white-space:pre-wrap;font-size:12px;background:#450a0a;color:#fecaca;padding:12px;border-radius:8px;border:1px solid #991b1b;">JSX/TSX Compile Error:\n${compiled.error.replace(/</g, '&lt;')}</pre>
</body></html>`;
    }

    const compiledLiteral = escapeJsonForScript(compiled.compiledJs);
    const targetNameLiteral = escapeJsonForScript(compiled.targetName || 'App');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      background: ${isDark ? '#141416' : '#ffffff'};
      color: ${isDark ? '#f4f4f5' : '#18181b'};
    }
    button { cursor: pointer; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="err" style="display:none;margin-top:12px;padding:12px;border-radius:10px;border:1px solid #991b1b;background:#450a0a;color:#fecaca;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;"></div>
  <script>
    (function() {
      var errEl = document.getElementById('err');
      function showError(msg) {
        errEl.style.display = 'block';
        errEl.textContent = msg;
      }

      function loadScript(src) {
        return new Promise(function(resolve, reject) {
          var s = document.createElement('script');
          s.src = src;
          s.crossOrigin = 'anonymous';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      async function ensureReact() {
        if (window.React && window.ReactDOM) return true;
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js');
          await loadScript('https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js');
          return Boolean(window.React && window.ReactDOM);
        } catch (_) {
          return false;
        }
      }

      function makeLucideProxy(React) {
        return new Proxy({}, {
          get: function(_target, prop) {
            return function IconStub(props) {
              var p = props || {};
              var size = p.size || 16;
              return React.createElement(
                'svg',
                {
                  width: size,
                  height: size,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  className: p.className || '',
                  'aria-label': String(prop)
                },
                React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
                React.createElement('path', { d: 'M12 8v8M8 12h8' })
              );
            };
          }
        });
      }

      ensureReact().then(function(ready) {
        if (!ready) {
          showError('Unable to load React runtime from CDN. Check network access or open as HTML.');
          return;
        }
        try {
          var React = window.React;
          var ReactDOM = window.ReactDOM;
          var __LucideProxy = makeLucideProxy(React);
          var __motionTag = function(tag) {
            return function MotionStub(props) {
              var clean = Object.assign({}, props);
              delete clean.initial;
              delete clean.animate;
              delete clean.exit;
              delete clean.transition;
              delete clean.whileHover;
              delete clean.whileTap;
              return React.createElement(tag, clean);
            };
          };
          var motion = new Proxy({}, { get: function(_, t) { return __motionTag(String(t)); } });
          var AnimatePresence = function(props) { return props.children || null; };

          var jsCode = ${compiledLiteral};
          var targetName = ${targetNameLiteral};
          var runner = new Function(
            'React',
            'ReactDOM',
            '__LucideProxy',
            'motion',
            'AnimatePresence',
            jsCode + '\\nreturn (typeof ' + targetName + ' !== "undefined" ? ' + targetName + ' : (typeof App !== "undefined" ? App : null));'
          );
          var RootComp = runner(React, ReactDOM, __LucideProxy, motion, AnimatePresence);
          if (!RootComp) {
            showError('No React component found to render. Export a default function component.');
            return;
          }
          var rootEl = document.getElementById('root');
          function __ErrorBoundary(props) {
            this.state = { err: null };
          }
          __ErrorBoundary.prototype = Object.create(React.Component.prototype);
          __ErrorBoundary.getDerivedStateFromError = function(err) { return { err: err }; };
          __ErrorBoundary.prototype.render = function() {
            if (this.state.err) {
              return React.createElement(
                'div',
                { style: { padding: 12, borderRadius: 10, border: '1px solid #991b1b', background: '#450a0a', color: '#fecaca', fontFamily: 'ui-monospace, monospace', fontSize: 12 } },
                'Component Render Error: ' + (this.state.err.message || String(this.state.err))
              );
            }
            return this.props.children;
          };
          var childEl = typeof RootComp === 'function' ? React.createElement(RootComp) : RootComp;
          var el = React.createElement(__ErrorBoundary, null, childEl);
          if (ReactDOM.createRoot) {
            ReactDOM.createRoot(rootEl).render(el);
          } else {
            ReactDOM.render(el, rootEl);
          }
        } catch (e) {
          showError('React Runtime Error:\\n' + (e && e.message ? e.message : String(e)));
        }
      });
    })();
  </script>
</body>
</html>`;
  }

  if (artifact.language === 'css') {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, sans-serif; background: #ffffff; color: #18181b; }
    .specimen-wrap { max-width: 640px; margin: 0 auto; display: grid; gap: 16px; }
    .specimen-meta { font-size: 11px; color: #71717a; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; }
  </style>
  <style>${artifact.code}</style>
</head>
<body>
  <div class="specimen-wrap">
    <div class="specimen-meta">Live CSS Specimen Preview</div>
    <div class="card container box panel">
      <h1>Heading Sample</h1>
      <p>Paragraph text rendered with your stylesheet rules.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn button primary">Primary Action</button>
        <button class="btn button secondary">Secondary</button>
        <span class="badge tag chip">Tag Sample</span>
      </div>
    </div>
    <input class="input" type="text" placeholder="Sample text input" />
  </div>
</body>
</html>`;
  }

  if (artifact.language === 'javascript') {
    const isDark = theme === 'dark';
    let compiledJs = artifact.code;
    try {
      compiledJs = sucraseTransform(artifact.code, {
        transforms: ['typescript'],
        production: true,
      }).code;
    } catch {
      // Fallback to raw code if sucrase encounters plain non-TS syntax edge case
    }
    const codeLiteral = escapeJsonForScript(compiledJs);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.6;
      background: ${isDark ? '#09090b' : '#fafafa'};
      color: ${isDark ? '#e4e4e7' : '#18181b'};
    }
    .log { padding: 6px 10px; border-bottom: 1px solid ${isDark ? '#27272a' : '#e4e4e7'}; white-space: pre-wrap; word-break: break-word; }
    .warn { color: #f59e0b; }
    .err { color: #f43f5e; }
    .ret { color: #10b981; }
    #stage { margin-bottom: 12px; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <div id="logs"></div>
  <script>
    (function() {
      var logsEl = document.getElementById('logs');
      function appendLine(kind, args) {
        var div = document.createElement('div');
        div.className = 'log ' + kind;
        var text = Array.prototype.slice.call(args).map(function(a) {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a, null, 2); } catch (_) { return String(a); }
        }).join(' ');
        div.textContent = text;
        logsEl.appendChild(div);
      }
      console.log = function() { appendLine('', arguments); };
      console.info = function() { appendLine('', arguments); };
      console.warn = function() { appendLine('warn', arguments); };
      console.error = function() { appendLine('err', arguments); };
      try {
        var result = new Function(${codeLiteral})();
        if (typeof result !== 'undefined') {
          appendLine('ret', ['-> ' + (typeof result === 'string' ? result : JSON.stringify(result, null, 2))]);
        }
        if (logsEl.children.length === 0 && document.body.children.length <= 2 && document.getElementById('stage').children.length === 0) {
          appendLine('', ['Executed cleanly (no console output).']);
        }
      } catch (e) {
        appendLine('err', ['Error: ' + (e && e.message ? e.message : String(e))]);
      }
    })();
  </script>
</body>
</html>`;
  }

  return artifact.code;
}

export async function exportSvgToPng(
  svgCode: string,
  filename = 'ashutosh-gpt-graphic.png',
): Promise<boolean> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalizeSvgMarkup(svgCode), 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return false;

    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([serialized], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(svgBlob);

    return await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const w = Math.max(200, img.naturalWidth || 800);
        const h = Math.max(200, img.naturalHeight || 600);
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(false);
          return;
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url);
          if (!pngBlob) {
            resolve(false);
            return;
          }
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(pngUrl), 1500);
          resolve(true);
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });
  } catch {
    return false;
  }
}
