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
    supportsModelListing: false,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
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
    supportsModelListing: false,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
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
    supportsModelListing: false,
    apiKeyFormat: '填写平台密钥',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4-flash',
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
    supportsModelListing: false,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
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
    supportsModelListing: false,
    apiKeyFormat: '填写平台密钥',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-flash-250615',
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
    supportsModelListing: false,
    apiKeyFormat: 'sk-...',
    defaultBaseUrl: 'https://api.siliconflow.com/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
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
