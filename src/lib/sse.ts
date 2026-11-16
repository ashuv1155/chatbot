import type { SearchProgress, SearchSource } from '../types/chat';

export interface StreamChunk {
  id?: string;
  model?: string;
  ashutosh_meta?: SearchProgress & {
    sources?: SearchSource[];
  };
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

/**
 * Robust incremental SSE parser that handles both standard newline-delimited
 * `data: {...}\n\n` frames and concatenated `data: {...}data: {...}` frames.
 */
export class SSEChunkParser {
  private buffer = '';

  push(text: string): { events: StreamChunk[]; done: boolean } {
    this.buffer += text;
    const events: StreamChunk[] = [];
    let done = false;

    while (true) {
      const dataIdx = this.buffer.indexOf('data:');
      if (dataIdx === -1) {
        // Keep a tiny tail in case "data:" is split across chunks
        if (this.buffer.length > 10) {
          this.buffer = this.buffer.slice(-10);
        }
        break;
      }

      // Discard everything before "data:"
      if (dataIdx > 0) {
        this.buffer = this.buffer.slice(dataIdx);
      }

      // Skip "data:" and optional whitespace
      let cursor = 5;
      while (
        cursor < this.buffer.length &&
        (this.buffer[cursor] === ' ' || this.buffer[cursor] === '\t')
      ) {
        cursor++;
      }

      if (cursor >= this.buffer.length) {
        break;
      }

      if (this.buffer.startsWith('[DONE]', cursor)) {
        done = true;
        this.buffer = this.buffer.slice(cursor + 6);
        continue;
      }

      if (this.buffer[cursor] === '{') {
        const jsonEnd = findCompleteJsonEnd(this.buffer, cursor);
        if (jsonEnd === -1) {
          // Incomplete JSON object; wait for more bytes
          break;
        }
        const jsonSlice = this.buffer.slice(cursor, jsonEnd + 1);
        this.buffer = this.buffer.slice(jsonEnd + 1);
        try {
          const parsed = JSON.parse(jsonSlice) as StreamChunk;
          events.push(parsed);
        } catch {
          // Ignore malformed frame and continue scanning
        }
        continue;
      }

      // Non-JSON line (e.g. comment or unexpected format): advance to next newline
      const nlIdx = this.buffer.indexOf('\n', cursor);
      if (nlIdx === -1) {
        break;
      }
      this.buffer = this.buffer.slice(nlIdx + 1);
    }

    return { events, done };
  }
}

function findCompleteJsonEnd(str: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}
