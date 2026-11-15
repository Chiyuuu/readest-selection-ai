/**
 * Selection AI — ask an LLM about the text you selected in a book.
 *
 * Design note (important): this module is deliberately independent of
 * Readest's *paid* translation stack. It does NOT touch `utils/access`,
 * `isCustomTranslatorAllowed`, DeepL/Azure/Google quotas, subscription
 * checks, or any other entitlement gate. It only talks to an
 * OpenAI-compatible `/chat/completions` endpoint whose URL and API key the
 * user typed in themselves.
 *
 * Transport goes through `getAIFetch()` so in the Tauri Android app the
 * request is issued from the Rust side (no WebView CORS preflight, no
 * cleartext-traffic block). Web builds fall back to `window.fetch`.
 */
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

export type SelectionAITask = 'ask' | 'explain' | 'translate' | 'dictionary' | 'summarize';

export interface SelectionAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SelectionAIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SelectionAIRequest {
  config: SelectionAIConfig;
  task: SelectionAITask;
  /** Already assembled into the first user turn by the popup. */
  history: SelectionAIMessage[];
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  /** Called before an automatic non-streaming retry, to clear partial output. */
  onReset?: () => void;
}

const LOCAL_CONFIG_KEY = 'readest-selection-ai-config';

/** One-click starting point for a Chinese reader; the key is always user-supplied. */
export const DEEPSEEK_PRESET: SelectionAIConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
};

export const loadLocalAIConfig = (): SelectionAIConfig | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SelectionAIConfig>;
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) return null;
    return {
      baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
      apiKey: parsed.apiKey,
      model: parsed.model,
    };
  } catch {
    return null;
  }
};

export const saveLocalAIConfig = (config: SelectionAIConfig | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!config) window.localStorage.removeItem(LOCAL_CONFIG_KEY);
    else window.localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Private browsing / storage disabled: config simply won't persist.
  }
};

/**
 * Resolve the endpoint to use. A config entered in the selection popup wins;
 * otherwise we reuse the credentials the user already entered in
 * Settings > AI (OpenRouter / any OpenAI-compatible provider, or Ollama).
 * Vercel AI Gateway uses a proprietary protocol and cannot be called through
 * a plain chat/completions request, so it is intentionally not supported.
 */
export const resolveSelectionAIConfig = (
  settings?: AISettings | null,
): SelectionAIConfig | null => {
  const local = loadLocalAIConfig();
  if (local) return local;

  const s = settings ?? DEFAULT_AI_SETTINGS;
  if (s.provider === 'openrouter') {
    const apiKey = s.openrouterApiKey?.trim();
    if (!apiKey) return null;
    return {
      baseUrl: (s.openrouterBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      apiKey,
      model: (s.openrouterModel || 'openai/gpt-4o-mini').trim(),
    };
  }
  if (s.provider === 'ollama') {
    const base = (s.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    return {
      baseUrl: `${base}/v1`,
      apiKey: 'ollama',
      model: (s.ollamaModel || 'llama3.2').trim(),
    };
  }
  return null;
};

const TASK_SYSTEM_PROMPTS: Record<SelectionAITask, string> = {
  ask: `你是一位耐心、严谨的阅读助手。读者会给你一段正在阅读的书中文字以及一个问题。
请紧紧围绕这段文字和给出的上下文作答，必要时补充背景知识，但不要臆造书中没有的情节。
若问题与文本无关，简短说明并回到文本。用与读者提问相同的语言回答。`,
  explain: `你是一位文本细读导师。请讲解读者选中的这段文字：字面含义、关键概念/典故、
句法或修辞、在全书语境中可能的作用，以及容易误解的地方。分点说明，语言清晰，
用与选中文本相同的语言回答。不要剧透后文。`,
  translate: `你是一位专业文学翻译。请把读者选中的文字忠实、流畅地翻译：
若原文不是中文，译成简体中文；若原文已是中文，译成自然、地道的英文。
保留原有分段与语气，只输出译文，不要添加解释、注释或前后缀。`,
  dictionary: `你是一部"语境词典"。读者选中了书中的一个词或短语，并给出了它所在的上下文。
请按以下结构回答（用简体中文）：
1. 词条与读音（英文给出音标，中文给出拼音）
2. 词性
3. 【在本句语境中的确切含义】——结合上下文解释，并说明为什么其他常见义项在这里不适用
4. 中文对应表达 / 贴切译法
5. 一个来自该语境的仿写例句
6. 常见搭配或近义辨析（若有）
若选中内容是多个词，先指出核心词，再解释整体。不要泛泛罗列所有义项。`,
  summarize: `请用简洁的中文概括读者选中文字的要点：主旨、关键论据或情节、值得留意的细节。
不超过 5 条，忠于原文，不添加原文没有的信息。`,
};

export const getTaskSystemPrompt = (task: SelectionAITask): string => TASK_SYSTEM_PROMPTS[task];

export const TASK_LABELS: Record<SelectionAITask, string> = {
  ask: '提问',
  explain: '解释',
  translate: 'AI 翻译',
  dictionary: '语境词典',
  summarize: '总结',
};

/** Build the *first* user turn: the selected text and its optional surroundings. */
export const buildSelectionUserMessage = (
  task: SelectionAITask,
  selection: string,
  context?: string,
  bookTitle?: string,
): string => {
  const parts: string[] = [];
  if (bookTitle) parts.push(`<BOOK>${bookTitle}</BOOK>`);
  if (context && context.trim() && context.trim() !== selection.trim()) {
    parts.push(`<CONTEXT>\n${context.slice(0, 2000)}\n</CONTEXT>`);
  }
  parts.push(`<SELECTION>\n${selection.slice(0, 6000)}\n</SELECTION>`);
  const directives: Record<SelectionAITask, string> = {
    ask: '请回答读者关于这段选中文字的问题。',
    explain: '请讲解这段选中文字。',
    translate: '请翻译 <SELECTION> 中的全部文字。',
    dictionary: '请把 <SELECTION> 当作词条，结合 <CONTEXT> 给出语境释义。',
    summarize: '请概括这段选中文字。',
  };
  parts.push(directives[task]);
  return parts.join('\n');
};

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  error?: { message?: string };
}

const parseSSEChunk = (payload: string): string => {
  try {
    const json = JSON.parse(payload) as ChatCompletionChunk;
    return json.choices?.[0]?.delta?.content ?? '';
  } catch {
    return '';
  }
};

/**
 * Stream one chat completion into `onDelta`.
 *
 * Robustness: some OpenAI-compatible proxies ignore `stream: true` and reply
 * with a normal JSON body; Tauri's HTTP plugin may also expose no readable
 * body on older Android WebViews. We detect both and transparently retry in
 * non-streaming mode so the feature still works instead of showing a blank.
 */
export const streamSelectionAI = async (req: SelectionAIRequest): Promise<void> => {
  const { config, task, history, signal, onDelta, onReset } = req;
  const httpFetch = getAIFetch();
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const messages = [
    { role: 'system', content: getTaskSystemPrompt(task) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const call = async (stream: boolean): Promise<string> => {
    const response = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream,
        temperature: 0.3,
      }),
      signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    const isSSE = stream && contentType.includes('text/event-stream') && !!response.body;

    if (!isSSE) {
      const json = (await response.json()) as ChatCompletionChunk;
      if (json.error?.message) throw new Error(json.error.message);
      const text = json.choices?.[0]?.message?.content ?? '';
      if (text) onDelta(text);
      return text;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let collected = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        const delta = parseSSEChunk(payload);
        if (delta) {
          collected += delta;
          onDelta(delta);
        }
      }
    }
    return collected;
  };

  // First attempt: streaming. If it yields nothing, retry once without stream.
  // `onDelta` is only called on the successful path, so a partial-but-empty
  // stream never produces duplicated text.
  let streamed = '';
  try {
    streamed = await call(true);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    onReset?.();
    const retry = await call(false);
    if (!retry) throw err;
    return;
  }
  if (!streamed) {
    onReset?.();
    const retry = await call(false);
    if (!retry) throw new Error('Empty response from AI endpoint');
  }
};
