import botConfigJson from '../../../../bot.config.json';

export interface BotLlmChainStage {
  provider: 'groq' | 'gemini' | 'workers-ai';
  model: string;
  timeoutMs: number;
}

export interface BotLlmConfig {
  provider: 'groq';
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyCallBudget: number;
  /**
   * 無応答ゼロ化チェーン（2026-07-17 Fable設計）。未指定なら下の getBotConfig() が
   * 旧来の単一プロバイダ設定（provider/model/timeoutMs）から1段チェーンを合成する
   * ため、既存の bot.config.json をそのまま使っているアプリ（web-ios-android の
   * templates/line-bot 等）の後方互換を壊さない。
   */
  chain: BotLlmChainStage[];
}

export interface BotCacheConfig {
  enabled: boolean;
  ttlHours: number;
}

export interface BotRetrievalConfig {
  topK: number;
  minScore: number;
}

export interface BotProjectEntry {
  knowledgePack: string;
}

export interface BotConfig {
  /** @deprecated use defaultProject. Kept for callers that still read `.project`. */
  project: string;
  defaultProject: string;
  projects: Record<string, BotProjectEntry>;
  llm: BotLlmConfig;
  cache: BotCacheConfig;
  retrieval: BotRetrievalConfig;
}

type RawBotLlmConfig = Omit<BotLlmConfig, 'chain'> & { chain?: BotLlmChainStage[] };

type RawBotConfig = {
  // Legacy single-project shape.
  project?: string;
  knowledgePack?: string;
  // New multi-project shape.
  defaultProject?: string;
  projects?: Record<string, BotProjectEntry>;
  llm: RawBotLlmConfig;
  cache?: Partial<BotCacheConfig>;
  retrieval?: Partial<BotRetrievalConfig>;
};

/** Runtime defaults from bot.config.json (project-specific values live there, not in code). */
export function getBotConfig(): BotConfig {
  const raw = botConfigJson as RawBotConfig;

  const defaultProject = raw.defaultProject ?? raw.project ?? '';
  const projects: Record<string, BotProjectEntry> =
    raw.projects ??
    (raw.knowledgePack ? { [defaultProject]: { knowledgePack: raw.knowledgePack } } : {});

  // chain 未指定時は、旧来の単一プロバイダ設定(provider/model/timeoutMs)から
  // 1段チェーンを合成する。既存の bot.config.json（web-ios-android の
  // templates/line-bot 等、まだ chain 化していないアプリ）を壊さないための後方互換。
  const chain: BotLlmChainStage[] = raw.llm.chain ?? [
    { provider: raw.llm.provider, model: raw.llm.model, timeoutMs: raw.llm.timeoutMs },
  ];

  return {
    project: defaultProject,
    defaultProject,
    projects,
    llm: { ...raw.llm, chain },
    cache: {
      enabled: raw.cache?.enabled ?? true,
      ttlHours: raw.cache?.ttlHours ?? 72,
    },
    retrieval: {
      topK: raw.retrieval?.topK ?? 3,
      minScore: raw.retrieval?.minScore ?? 0,
    },
  };
}

/** The project used when a friend has no resolvable project (fail-closed default). */
export function getDefaultProject(): string {
  return getBotConfig().defaultProject;
}

/** Whether `project` is a configured project id (used for fail-closed fallback checks). */
export function isKnownProject(project: string): boolean {
  return project in getBotConfig().projects;
}
