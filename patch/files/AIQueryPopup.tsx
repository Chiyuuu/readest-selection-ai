'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiCopy, FiSend, FiSettings, FiTrash2, FiX } from 'react-icons/fi';

import Popup from '@/components/Popup';
import { useSettingsStore } from '@/store/settingsStore';
import { Position } from '@/utils/sel';
import { writeTextToClipboard } from '@/utils/clipboard';
import {
  DEEPSEEK_PRESET,
  TASK_LABELS,
  buildSelectionUserMessage,
  loadLocalAIConfig,
  resolveSelectionAIConfig,
  saveLocalAIConfig,
  streamSelectionAI,
  type SelectionAIConfig,
  type SelectionAIMessage,
  type SelectionAITask,
} from '@/services/ai/selectionQuery';

interface AIQueryPopupProps {
  /** The exact text the reader selected. */
  text: string;
  /** Surrounding sentence / paragraph, used by the contextual dictionary. */
  context?: string;
  bookTitle?: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface Turn {
  task: SelectionAITask;
  question: string;
  answer: string;
}

const QUICK_TASKS: SelectionAITask[] = ['explain', 'translate', 'dictionary', 'summarize'];

const appendToLast = (turns: Turn[], chunk: string): Turn[] => {
  if (turns.length === 0) return turns;
  const next = [...turns];
  const last = next[next.length - 1]!;
  next[next.length - 1] = { ...last, answer: last.answer + chunk };
  return next;
};

const resetLast = (turns: Turn[]): Turn[] => {
  if (turns.length === 0) return turns;
  const next = [...turns];
  const last = next[next.length - 1]!;
  next[next.length - 1] = { ...last, answer: '' };
  return next;
};

const AIQueryPopup: React.FC<AIQueryPopupProps> = ({
  text,
  context,
  bookTitle,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const { settings } = useSettingsStore();
  const [config, setConfig] = useState<SelectionAIConfig | null>(() =>
    resolveSelectionAIConfig(settings?.aiSettings),
  );
  const [draft, setDraft] = useState<SelectionAIConfig>(
    () => loadLocalAIConfig() ?? DEEPSEEK_PRESET,
  );
  const [showConfig, setShowConfig] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConfig(resolveSelectionAIConfig(settings?.aiSettings));
  }, [settings?.aiSettings]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const buildHistory = useCallback(
    (allTurns: Turn[], task: SelectionAITask): SelectionAIMessage[] => {
      const history: SelectionAIMessage[] = [];
      allTurns.forEach((turn, index) => {
        history.push({
          role: 'user',
          content:
            index === 0
              ? buildSelectionUserMessage(task, text, context, bookTitle)
              : turn.question || '请继续展开说明。',
        });
        if (turn.answer) history.push({ role: 'assistant', content: turn.answer });
      });
      return history;
    },
    [text, context, bookTitle],
  );

  const run = useCallback(
    async (task: SelectionAITask, prompt: string) => {
      if (!config) {
        setShowConfig(true);
        return;
      }
      if (loading) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const nextTurns: Turn[] = [...turns, { task, question: prompt, answer: '' }];
      setTurns(nextTurns);
      setQuestion('');
      setError(null);
      setLoading(true);
      try {
        await streamSelectionAI({
          config,
          task,
          history: buildHistory(nextTurns, task),
          signal: controller.signal,
          onReset: () => setTurns((prev) => resetLast(prev)),
          onDelta: (chunk) => setTurns((prev) => appendToLast(prev, chunk)),
        });
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setError((err as Error)?.message || String(err));
        }
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [config, loading, turns, text, context, bookTitle, buildHistory],
  );

  const handleSaveConfig = () => {
    const cleaned: SelectionAIConfig = {
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    };
    if (!cleaned.baseUrl || !cleaned.apiKey || !cleaned.model) {
      setError('请填写完整的 Base URL、API Key 和模型名称。');
      return;
    }
    saveLocalAIConfig(cleaned);
    setConfig(cleaned);
    setShowConfig(false);
    setError(null);
  };

  const handleUseOfficialSettings = () => {
    saveLocalAIConfig(null);
    setConfig(resolveSelectionAIConfig(settings?.aiSettings));
    setShowConfig(false);
  };

  const handleCopyAll = async () => {
    const content = turns.map((t) => t.answer).filter(Boolean).join('\n\n');
    if (!content) return;
    await writeTextToClipboard(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const content = (
    <div className='flex h-full flex-col overflow-hidden rounded-lg bg-base-100 text-base-content'>
      {/* Header */}
      <div className='flex shrink-0 items-center justify-between border-b border-base-content/10 px-3 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='text-sm font-semibold'>问 AI</span>
          <span className='truncate text-xs opacity-60'>
            {config ? config.model : '未配置'}
          </span>
        </div>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            aria-label='AI 接口设置'
            title='AI 接口设置'
            className='rounded p-1.5 hover:bg-base-200'
            onClick={() => setShowConfig((v) => !v)}
          >
            <FiSettings size={16} />
          </button>
          {turns.length > 0 && (
            <button
              type='button'
              aria-label='清空对话'
              title='清空对话'
              className='rounded p-1.5 hover:bg-base-200'
              onClick={() => {
                abortRef.current?.abort();
                setTurns([]);
                setError(null);
              }}
            >
              <FiTrash2 size={16} />
            </button>
          )}
          <button
            type='button'
            aria-label='关闭'
            className='rounded p-1.5 hover:bg-base-200'
            onClick={onDismiss}
          >
            <FiX size={18} />
          </button>
        </div>
      </div>

      {/* Selected passage */}
      <div className='shrink-0 border-b border-base-content/10 px-3 py-2'>
        <div className='max-h-20 overflow-y-auto rounded bg-base-200/70 px-2 py-1.5 text-xs leading-relaxed opacity-80 select-text'>
          {text.length > 800 ? `${text.slice(0, 800)}…` : text}
        </div>
      </div>

      {/* Quick actions */}
      <div className='flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2' style={{ scrollbarWidth: 'none' }}>
        {QUICK_TASKS.map((task) => (
          <button
            key={task}
            type='button'
            disabled={loading || !config}
            className='shrink-0 rounded-full border border-base-content/20 px-3 py-1 text-xs hover:bg-base-200 disabled:opacity-40'
            onClick={() => void run(task, '')}
          >
            {TASK_LABELS[task]}
          </button>
        ))}
      </div>

      {/* Settings panel */}
      {showConfig && (
        <div className='shrink-0 space-y-2 border-y border-base-content/10 bg-base-200/50 px-3 py-2 text-xs'>
          <p className='opacity-70'>
            填入你自己的 OpenAI 兼容接口（DeepSeek / OpenRouter / Ollama / 自建网关）。
            Key 仅保存在本机，不经过任何 Readest 服务端，也不影响官方订阅额度。
          </p>
          <input
            className='w-full rounded border border-base-content/20 bg-base-100 px-2 py-1'
            placeholder='Base URL，如 https://api.deepseek.com/v1'
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
          <input
            className='w-full rounded border border-base-content/20 bg-base-100 px-2 py-1'
            placeholder='API Key'
            type='password'
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
          <input
            className='w-full rounded border border-base-content/20 bg-base-100 px-2 py-1'
            placeholder='模型名，如 deepseek-chat'
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
          <div className='flex flex-wrap gap-1.5'>
            <button
              type='button'
              className='rounded bg-base-300 px-2 py-1'
              onClick={() => setDraft({ ...DEEPSEEK_PRESET, apiKey: draft.apiKey })}
            >
              填入 DeepSeek 预设
            </button>
            <button
              type='button'
              className='rounded bg-primary px-2 py-1 text-primary-content'
              onClick={handleSaveConfig}
            >
              保存
            </button>
            <button type='button' className='rounded px-2 py-1 hover:bg-base-300' onClick={handleUseOfficialSettings}>
              改用「设置 → AI」中的配置
            </button>
          </div>
        </div>
      )}

      {/* Conversation */}
      <div ref={bodyRef} className='min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 text-sm select-text'>
        {!config && (
          <div className='rounded border border-base-content/15 p-3 text-xs leading-relaxed opacity-80'>
            还没有配置 AI 接口。点击右上角齿轮，填入 Base URL / API Key / 模型名即可使用；
            也可以先在「设置 → AI」里选 OpenRouter（自定义）并填好凭据。
          </div>
        )}
        {turns.length === 0 && config && (
          <div className='py-2 text-xs opacity-60'>
            点上方快捷按钮，或在下方输入你的问题。支持基于这段选中文字连续追问。
          </div>
        )}
        {turns.map((turn, index) => (
          <div key={index} className='space-y-1'>
            {turn.question && (
              <div className='text-xs font-medium opacity-70'>
                [{TASK_LABELS[turn.task]}] {turn.question}
              </div>
            )}
            {!turn.question && (
              <div className='text-xs opacity-50'>[{TASK_LABELS[turn.task]}]</div>
            )}
            <div className='whitespace-pre-wrap leading-relaxed'>
              {turn.answer || (loading && index === turns.length - 1 ? '思考中…' : '')}
            </div>
          </div>
        ))}
        {error && (
          <div className='rounded border border-error/40 bg-error/10 p-2 text-xs text-error'>
            请求失败：{error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className='flex shrink-0 items-center gap-2 border-t border-base-content/10 px-3 py-2'>
        <input
          ref={inputRef}
          className='min-w-0 flex-1 rounded border border-base-content/20 bg-base-100 px-2 py-1.5 text-sm'
          placeholder='就这段文字问点什么…'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (question.trim()) void run('ask', question.trim());
              else setShowConfig(true);
            }
          }}
        />
        <button
          type='button'
          aria-label='发送'
          disabled={loading || !question.trim()}
          className='rounded bg-primary p-2 text-primary-content disabled:opacity-40'
          onClick={() => {
            if (!config) {
              setShowConfig(true);
              return;
            }
            if (question.trim()) void run('ask', question.trim());
          }}
        >
          <FiSend size={16} />
        </button>
        {turns.some((t) => t.answer) && (
          <button
            type='button'
            aria-label='复制回答'
            title={copied ? '已复制' : '复制回答'}
            className='rounded p-2 hover:bg-base-200'
            onClick={() => void handleCopyAll()}
          >
            <FiCopy size={16} />
          </button>
        )}
      </div>
    </div>
  );

  // Small screens / short landscape: a bottom sheet reads far better than an
  // anchored popup (same heuristic Readest uses for DictionarySheet).
  const useSheet =
    typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight < 640);
  if (useSheet) {
    return (
      <div
        className='fixed inset-0 z-50 flex items-end justify-center bg-black/40'
        onClick={onDismiss}
      >
        <div
          className='flex max-h-[82vh] min-h-[55vh] w-full flex-col overflow-hidden rounded-t-2xl bg-base-100 shadow-2xl'
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={onDismiss}
    >
      {content}
    </Popup>
  );
};

export default AIQueryPopup;
