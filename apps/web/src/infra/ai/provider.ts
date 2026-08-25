export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured. Generation is server-side only.");
    this.name = "AiNotConfiguredError";
  }
}

export type TextGenerationRequest = {
  instruction: string;
  untrustedData: string;
};

export type StructuredGenerationRequest = {
  schemaName: string;
  instruction: string;
  untrustedData: string;
};

export type EmbeddingRequest = {
  texts: string[];
};

export type ExtractionRequest = StructuredGenerationRequest;
export type ClassificationRequest = {
  labels: string[];
  untrustedData: string;
};

export interface AiProvider {
  readonly name: string;
  generateText(request: TextGenerationRequest): Promise<string>;
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>;
  embed(request: EmbeddingRequest): Promise<number[][]>;
  extract(request: ExtractionRequest): Promise<unknown>;
  classify(request: ClassificationRequest): Promise<{ label: string; confidence: number }>;
  completeStructured(request: StructuredGenerationRequest): Promise<unknown>;
}
