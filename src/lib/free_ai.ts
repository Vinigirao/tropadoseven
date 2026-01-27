/**
 * Free AI helper using Hugging Face Router (Inference Providers).
 *
 * Env:
 * - HF_API_TOKEN (required): Hugging Face token with "Inference Providers" permission
 * - HF_MODEL_ID (optional): model id on HF Hub (default below)
 *
 * Uses OpenAI-compatible endpoint:
 * - POST https://router.huggingface.co/v1/chat/completions
 */
export type GenerateTextOptions = {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
const HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";

function redact(s: string) {
  return s.replace(/hf_[A-Za-z0-9]+/g, "hf_***");
}

export async function generateText(prompt: string, opts: GenerateTextOptions = {}) {
  const token = process.env.HF_API_TOKEN;
  const model = process.env.HF_MODEL_ID || DEFAULT_MODEL;

  if (!token) {
    throw new Error(
      "HF_API_TOKEN não configurado. Crie um token na Hugging Face com permissão 'Inference Providers' e defina em HF_API_TOKEN."
    );
  }

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.2,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(HF_ROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Hugging Face Router respondeu ${res.status}: ${redact(text)}`
      );
    }

    // OpenAI-compatible response
    const json = JSON.parse(text) as any;
    const content = json?.choices?.[0]?.message?.content?.trim?.() ?? "";
    return content;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Timeout ao chamar o Hugging Face Router");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
