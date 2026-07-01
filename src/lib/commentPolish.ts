const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "o4-mini";

const SYSTEM_PROMPT =
  "You are an editor preparing a council routine property inspection report. " +
  "Rewrite the inspector's note so it has correct grammar, spelling and " +
  "punctuation and reads clearly and professionally, suitable for a formal " +
  "report. Preserve the original meaning and every factual detail — do not add, " +
  "remove, or invent information. Keep it concise. Return only the revised text, " +
  "with no preamble, quotation marks, or explanation.";

/**
 * Ask OpenAI (o4-mini) to tidy a comment's grammar and professionalism.
 *
 * Returns the revised text, or null when OpenAI isn't configured, the input is
 * blank, the call fails/times out, or the model returns the text unchanged.
 * Callers fall back to the original comment, so report generation never blocks
 * on this being available.
 */
export async function polishComment(original: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const text = original.trim();
  if (!text) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        // o4-mini is a reasoning model: no temperature, and the token cap covers
        // reasoning + output, so keep headroom above the visible text length.
        reasoning_effort: "low",
        max_completion_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(
        `[commentPolish] OpenAI request failed: ${res.status} ${await res
          .text()
          .catch(() => "")}`,
      );
      return null;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const revised = json.choices?.[0]?.message?.content?.trim();
    if (!revised || revised === text) return null;
    return revised;
  } catch (e) {
    console.error(
      "[commentPolish] OpenAI request errored:",
      e instanceof Error ? e.message : e,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
