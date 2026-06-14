export interface ModelOption {
  id: string;
  label: string;
  provider: 'codex' | 'openai' | 'anthropic';
  description: string;
}

export const CODEX_MODELS: ModelOption[] = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    provider: 'codex',
    description: 'Frontier model for complex coding, research, and real-world work.',
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    provider: 'codex',
    description: 'Strong model for everyday coding.',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4-Mini',
    provider: 'codex',
    description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    provider: 'codex',
    description: 'Ultra-fast coding model.',
  },
];

export const DEFAULT_CODEX_MODEL = CODEX_MODELS[0]?.id ?? 'gpt-5.5';
