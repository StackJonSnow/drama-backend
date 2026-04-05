export type AIProtocol = 'cloudflare' | 'openai-compatible' | 'anthropic';

export interface AIServiceDefinition {
  id: string;
  name: string;
  description: string;
  protocol: AIProtocol;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  requiresModel: boolean;
  supportsModelListing: boolean;
  isDefault?: boolean;
  apiKeyFormat?: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  recentModels?: Array<{ value: string; label: string }>;
  tags?: string[];
}

const AI_SERVICES: AIServiceDefinition[] = [
  {
    id: 'cloudflare-ai',
    name: 'Cloudflare Workers AI',
    description: 'Cloudflare 内置模型，免 API Key，适合作为开箱即用的默认渠道。',
    protocol: 'cloudflare',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    supportsModelListing: false,
    isDefault: true,
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    recentModels: [
      { value: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
      { value: '@cf/meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
      { value: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Fast' },
      { value: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
      { value: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
      { value: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B' },
    ],
    tags: ['默认', '内置'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 官方兼容 OpenAI 接口，适合中文创作与推理。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    recentModels: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
    ],
    tags: ['国产', 'OpenAI 兼容'],
  },
  {
    id: 'qwen',
    name: '通义千问 / DashScope',
    description: '阿里云百炼兼容 OpenAI 接口，可直接配置 Base URL 与模型。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    recentModels: [
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-max', label: 'Qwen Max' },
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
      { value: 'qwen3-32b', label: 'Qwen3 32B' },
      { value: 'qwen3-235b-a22b', label: 'Qwen3 235B A22B' },
    ],
    tags: ['国产', 'OpenAI 兼容'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    description: '智谱开放平台兼容 OpenAI 风格调用，适合中文场景。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: '填写平台密钥',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4-flash',
    recentModels: [
      { value: 'glm-4-flash', label: 'GLM-4 Flash' },
      { value: 'glm-4-air', label: 'GLM-4 Air' },
      { value: 'glm-4-plus', label: 'GLM-4 Plus' },
      { value: 'glm-4.5', label: 'GLM-4.5' },
    ],
    tags: ['国产', 'OpenAI 兼容'],
  },
  {
    id: 'kimi',
    name: 'Moonshot / Kimi',
    description: 'Moonshot 官方兼容 OpenAI 接口，常用于长文本和中文问答。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
    recentModels: [
      { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
      { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
      { value: 'kimi-k2-0711-preview', label: 'Kimi K2 Preview' },
    ],
    tags: ['国产', 'OpenAI 兼容'],
  },
  {
    id: 'doubao',
    name: '豆包 / 火山方舟',
    description: '火山引擎 Ark 兼容 OpenAI 接口，适合国内业务接入。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: '填写平台密钥',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-flash-250615',
    recentModels: [
      { value: 'doubao-seed-1-6-flash-250615', label: 'Doubao Seed 1.6 Flash' },
      { value: 'doubao-seed-1-6-pro-250615', label: 'Doubao Seed 1.6 Pro' },
      { value: 'doubao-seed-1-6-thinking-250715', label: 'Doubao Seed 1.6 Thinking' },
    ],
    tags: ['国产', 'OpenAI 兼容'],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    description: '硅基流动聚合模型平台，兼容 OpenAI 接口。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.siliconflow.com/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    recentModels: [
      { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
      { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
      { value: 'Qwen/Qwen3-32B', label: 'Qwen3 32B' },
      { value: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B A22B' },
    ],
    tags: ['国产', '聚合', 'OpenAI 兼容'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: '官方 OpenAI 渠道，适合作为国际通用兼容配置。',
    protocol: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    recentModels: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'o1', label: 'o1' },
      { value: 'o1-mini', label: 'o1 Mini' },
      { value: 'o3-mini', label: 'o3 Mini' },
    ],
    tags: ['国际', 'OpenAI 兼容'],
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    description: 'Anthropic 官方接口，适合高质量长文生成。',
    protocol: 'anthropic',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    supportsModelListing: true,
    apiKeyFormat: 'sk-ant-...',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    recentModels: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      { value: 'claude-3-5-sonnet-20240620', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    ],
    tags: ['国际', '官方'],
  },
];

export function getAIServiceCatalog(): AIServiceDefinition[] {
  return AI_SERVICES;
}

export function getAIServiceDefinition(serviceId: string): AIServiceDefinition | undefined {
  return AI_SERVICES.find((service) => service.id === serviceId);
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
