import { loadAppConfig, type AppConfig } from "@/config/env";

import { resolveChatProvider } from "./openai";

export type AiStatus = {
  ready: boolean;
  chatProvider: "groq" | "gemini" | "none";
  chatModel: string | null;
  embeddingsReady: boolean;
  embeddingModel: string | null;
  mode: AppConfig["aiChatProvider"];
};

export function describeAiStatus(): AiStatus {
  const config = loadAppConfig();
  if (!config.aiConfigured) {
    return {
      ready: false,
      chatProvider: "none",
      chatModel: null,
      embeddingsReady: false,
      embeddingModel: null,
      mode: config.aiChatProvider,
    };
  }

  try {
    const resolved = resolveChatProvider(config);
    return {
      ready: true,
      chatProvider: resolved.provider === "groq" ? "groq" : "gemini",
      chatModel: resolved.model,
      embeddingsReady: config.openaiConfigured,
      embeddingModel: config.openaiConfigured ? config.embeddingModel : null,
      mode: config.aiChatProvider,
    };
  } catch {
    return {
      ready: false,
      chatProvider: "none",
      chatModel: null,
      embeddingsReady: config.openaiConfigured,
      embeddingModel: config.openaiConfigured ? config.embeddingModel : null,
      mode: config.aiChatProvider,
    };
  }
}
