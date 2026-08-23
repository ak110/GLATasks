/**
 * @fileoverview ブラウザ内蔵AI APIの型宣言
 *
 * TypeScript 6.0.3の`lib.dom.d.ts`に型がないため宣言する。
 * TypeScriptが標準で型を同梱した場合は、このファイルを撤去する。
 */

declare global {
  type Availability =
    "available" | "downloadable" | "downloading" | "unavailable";

  interface DownloadProgressEvent extends Event {
    readonly loaded: number;
  }

  interface CreateMonitor {
    addEventListener(
      type: "downloadprogress",
      listener: (event: DownloadProgressEvent) => void,
    ): void;
  }

  type CreateMonitorCallback = (monitor: CreateMonitor) => void;

  interface TranslatorOperationOptions {
    signal?: AbortSignal;
  }

  interface TranslatorCreateOptions {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: CreateMonitorCallback;
    signal?: AbortSignal;
  }

  interface Translator {
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    translate(
      input: string,
      options?: TranslatorOperationOptions,
    ): Promise<string>;
    translateStreaming(
      input: string,
      options?: TranslatorOperationOptions,
    ): ReadableStream<string>;
    destroy(): void;
  }

  interface TranslatorConstructor {
    availability(options: {
      sourceLanguage: string;
      targetLanguage: string;
    }): Promise<Availability>;
    create(options: TranslatorCreateOptions): Promise<Translator>;
  }

  var Translator: TranslatorConstructor;

  interface LanguageDetectionResult {
    readonly detectedLanguage: string;
    readonly confidence: number;
  }

  interface LanguageDetectorCreateOptions {
    expectedInputLanguages?: string[];
    monitor?: CreateMonitorCallback;
    signal?: AbortSignal;
  }

  interface LanguageDetector {
    detect(
      input: string,
      options?: { signal?: AbortSignal },
    ): Promise<LanguageDetectionResult[]>;
    destroy(): void;
  }

  interface LanguageDetectorConstructor {
    availability(): Promise<Availability>;
    create(options?: LanguageDetectorCreateOptions): Promise<LanguageDetector>;
  }

  var LanguageDetector: LanguageDetectorConstructor;

  interface LanguageModelExpectedInput {
    type: "text";
    languages: string[];
  }

  interface LanguageModelExpectedOutput {
    type: "text";
    languages: string[];
  }

  interface LanguageModelInitialPrompt {
    role: "system" | "user" | "assistant";
    content: string;
  }

  interface LanguageModelCreateOptions {
    expectedInputs?: LanguageModelExpectedInput[];
    expectedOutputs?: LanguageModelExpectedOutput[];
    initialPrompts?: LanguageModelInitialPrompt[];
    monitor?: CreateMonitorCallback;
    signal?: AbortSignal;
  }

  interface LanguageModel {
    clone(options?: { signal?: AbortSignal }): Promise<LanguageModel>;
    prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
    promptStreaming(
      input: string,
      options?: { signal?: AbortSignal },
    ): ReadableStream<string>;
    destroy(): void;
  }

  interface LanguageModelConstructor {
    availability(options: LanguageModelCreateOptions): Promise<Availability>;
    create(options: LanguageModelCreateOptions): Promise<LanguageModel>;
  }

  var LanguageModel: LanguageModelConstructor;
}

export {};
