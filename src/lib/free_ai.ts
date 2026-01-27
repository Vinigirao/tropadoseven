import type { RequestInit } from 'next/dist/server/types';

/**
 * Helper to generate a completion using a free AI provider.
 *
 * This implementation uses the Hugging Face Inference API to call
 * a chat/instruction-tuned model.  You must set the environment
 * variable `HF_API_TOKEN` to a valid Hugging Face API token.  You can
 * optionally set `HF_MODEL_ID` to choose a specific model; if not
 * defined, a sensible default will be used.
 *
 * The returned text is trimmed and free of surrounding whitespace.
 */
export async function generateText(
  prompt: string,
  {
    maxTokens = 400,
    temperature = 0.2,
  }: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const apiToken = process.env.HF_API_TOKEN;
  if (!apiToken) {
    throw new Error('HF_API_TOKEN is not defined. Please add it to your environment variables.');
  }
  const modelId =
    process.env.HF_MODEL_ID || 'mistralai/Mistral-7B-Instruct-v0.1';
  const url = `https://api-inference.huggingface.co/models/${modelId}`;
  const body = {
    inputs: prompt,
    parameters: {
      max_new_tokens: maxTokens,
      temperature,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hugging Face API responded with status ${res.status}: ${text}`);
  }
  const data = await res.json();
  /**
   * The HF inference API may return either an array of objects with
   * `generated_text` or a single object with the text.  Normalise to
   * a string.
   */
  let generated = '';
  if (Array.isArray(data) && data.length > 0) {
    const candidate = data[0] as any;
    generated = candidate?.generated_text ?? '';
  } else if (data && typeof (data as any).generated_text === 'string') {
    generated = (data as any).generated_text;
  }
  return (generated ?? '').trim();
}
