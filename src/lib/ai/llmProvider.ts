/**
 * LLM Provider Abstraction for LeadPilot
 * Supports Gemini, OpenAI, or any compatible provider.
 * Follows strict provider-independence and graceful NOT_CONFIGURED handling.
 */

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMGenerateResult {
  text: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateText(
    prompt: string,
    systemInstruction?: string,
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult>;
}

export class GeminiLLMProvider implements LLMProvider {
  readonly name = 'gemini';
  private apiKey?: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    this.model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateText(
    prompt: string,
    systemInstruction?: string,
    options: LLMGenerateOptions = {}
  ): Promise<LLMGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('LLM_PROVIDER_NOT_CONFIGURED: Gemini API key is not configured.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const contents: any[] = [];
    if (systemInstruction) {
      contents.push({
        role: 'user',
        parts: [{ text: `System Instruction:\n${systemInstruction}` }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: 'Understood. I will strictly follow all instructions and grounding rules.' }],
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    const generationConfig: any = {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxTokens ?? 1500,
    };
    if (options.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini API error (HTTP ${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';

    return {
      text,
      model: this.model,
      provider: this.name,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
    };
  }
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey?: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateText(
    prompt: string,
    systemInstruction?: string,
    options: LLMGenerateOptions = {}
  ): Promise<LLMGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('LLM_PROVIDER_NOT_CONFIGURED: OpenAI API key is not configured.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const body: any = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1500,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`OpenAI API error (HTTP ${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      model: this.model,
      provider: this.name,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }
}

export class GroqLLMProvider implements LLMProvider {
  readonly name = 'groq';
  private apiKey?: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateText(
    prompt: string,
    systemInstruction?: string,
    options: LLMGenerateOptions = {}
  ): Promise<LLMGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('LLM_PROVIDER_NOT_CONFIGURED: Groq API key is not configured.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const body: any = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1500,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Groq API error (HTTP ${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      model: this.model,
      provider: this.name,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }
}

export class OpenRouterLLMProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey?: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateText(
    prompt: string,
    systemInstruction?: string,
    options: LLMGenerateOptions = {}
  ): Promise<LLMGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('LLM_PROVIDER_NOT_CONFIGURED: OpenRouter API key is not configured.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const body: any = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1500,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://caffie.io',
        'X-Title': 'Caffie LeadPilot',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`OpenRouter API error (HTTP ${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      model: this.model,
      provider: this.name,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }
}

export class NullLLMProvider implements LLMProvider {
  readonly name = 'none';

  isConfigured(): boolean {
    return false;
  }

  async generateText(): Promise<LLMGenerateResult> {
    throw new Error('LLM_PROVIDER_NOT_CONFIGURED: No LLM provider (Groq, OpenRouter, Gemini, or OpenAI) is configured in environment.');
  }
}

export class LLMProviderFactory {
  static getProvider(): LLMProvider {
    // 1. Prefer fast Groq if configured
    const groq = new GroqLLMProvider();
    if (groq.isConfigured()) return groq;

    // 2. OpenRouter fallback
    const openRouter = new OpenRouterLLMProvider();
    if (openRouter.isConfigured()) return openRouter;

    // 3. Gemini fallback
    const gemini = new GeminiLLMProvider();
    if (gemini.isConfigured()) return gemini;

    // 4. OpenAI fallback
    const openai = new OpenAILLMProvider();
    if (openai.isConfigured()) return openai;

    return new NullLLMProvider();
  }

  static getProviderStatus(): { configured: boolean; provider: string } {
    const p = this.getProvider();
    return {
      configured: p.isConfigured(),
      provider: p.name,
    };
  }
}
