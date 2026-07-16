import {
  lookupCachedAnswer,
  saveCachedAnswer,
  isCacheableQuestion,
} from './llm-cache.js';
import {
  searchKbArticles,
  formatKbContext,
  incrementGroqUsage,
  isGroqBudgetExceeded,
} from './kb-search.js';
import {
  getGroqReplyConfig,
  buildGroqHistory,
} from './groq-reply.js';
import { generateLlmReplyWithFallback } from './llm-chain.js';
import { getKnowledgePack } from './knowledge-packs.js';

export type GroqPipelineResult =
  | { kind: 'disabled' }
  | { kind: 'canned'; text: string; source: 'canned' | 'cache'; imageUrl?: string }
  | { kind: 'reply'; text: string; cacheable: boolean }
  | { kind: 'escalate'; text?: string }
  | { kind: 'fail_closed'; escalationText: string };

export interface GroqPipelineParams {
  db: D1Database;
  /** 1番手(Groq)のAPIキー。省略時はGroq段をスキップし、チェーンの後段のみ試す。 */
  apiKey?: string;
  /** 2番手(Gemini)のAPIキー。省略時はGemini段をスキップする。 */
  geminiApiKey?: string;
  /** 3番手(Cloudflare Workers AI)のバインディング。省略時はWorkers AI段をスキップする。 */
  workersAi?: Ai;
  /** webhook受信時刻(ms epoch)。チェーンの残り時間駆動スキップに使う。 */
  receivedAt: number;
  lineAccountId: string | null;
  friendId: string;
  incomingText: string;
  project: string;
}

/**
 * Tier1 cache → Tier1.5 canned → Tier2 RAG+Groq pipeline.
 * Fail-closed returns escalation text; does NOT fall through to Claude.
 */
export async function runGroqSupportPipeline(
  params: GroqPipelineParams,
): Promise<GroqPipelineResult> {
  const { db, apiKey, geminiApiKey, workersAi, receivedAt, lineAccountId, friendId, incomingText, project } = params;
  const pack = getKnowledgePack(project);

  const config = await getGroqReplyConfig(db, lineAccountId);
  if (!config.enabled) return { kind: 'disabled' };

  if (await isGroqBudgetExceeded(db, lineAccountId)) {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'fail_closed', escalationText: pack.getFailClosedEscalationText() };
  }

  const cached = await lookupCachedAnswer(db, incomingText, lineAccountId, project);
  if (cached) {
    await incrementGroqUsage(db, lineAccountId, 'cache_hits');
    return { kind: 'canned', text: cached, source: 'cache' };
  }

  const cannedWithImage = pack.matchCannedResponseWithImage?.(incomingText);
  if (cannedWithImage) {
    if (isCacheableQuestion(incomingText)) {
      await saveCachedAnswer(db, incomingText, cannedWithImage.text, lineAccountId, project);
    }
    return { kind: 'canned', text: cannedWithImage.text, source: 'canned', imageUrl: cannedWithImage.imageUrl };
  }

  const canned = pack.matchCannedResponse(incomingText);
  if (canned) {
    if (isCacheableQuestion(incomingText)) {
      await saveCachedAnswer(db, incomingText, canned, lineAccountId, project);
    }
    return { kind: 'canned', text: canned, source: 'canned' };
  }

  const kbHits = await searchKbArticles(db, incomingText, lineAccountId, project);
  const kbContext = formatKbContext(kbHits);
  const systemPrompt = pack.buildSystemPrompt(kbContext);
  const history = await buildGroqHistory(db, friendId);

  await incrementGroqUsage(db, lineAccountId, 'groq_calls');

  const groqResult = await generateLlmReplyWithFallback({
    systemPrompt,
    messages: history,
    incomingText,
    receivedAt,
    groqApiKey: apiKey,
    geminiApiKey,
    workersAi,
  });

  if (groqResult.kind === 'fail_closed') {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'fail_closed', escalationText: pack.getFailClosedEscalationText() };
  }

  if (groqResult.kind === 'escalate') {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'escalate', text: groqResult.text };
  }

  const text = groqResult.text!;
  const cacheable = isCacheableQuestion(incomingText);
  if (cacheable) {
    await saveCachedAnswer(db, incomingText, text, lineAccountId, project);
  }

  return { kind: 'reply', text, cacheable };
}
