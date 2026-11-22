export const LANGUAGE_TAGS = [
  "ar",
  "bg",
  "bn",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "kn",
  "ko",
  "lt",
  "mr",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-Hant",
] as const;

export const PROMPT_LANGUAGE_TAGS = ["en", "ja", "es", "de", "fr"] as const;

export type TranslateEngine = "translator" | "prompt";

export type TranslateSettings = {
  nativeLanguage: string;
  foreignLanguage: string;
  engine: TranslateEngine;
};

export type TranslationDirection = {
  sourceLanguage: string;
  targetLanguage: string;
};

export type PromptLanguageOptions = {
  expectedInputs: LanguageModelExpectedInput[];
  expectedOutputs: LanguageModelExpectedOutput[];
};

export const TRANSLATE_DEFAULTS = {
  nativeLanguage: "日本語",
  foreignLanguage: "英語",
  engine: "translator",
} as const satisfies TranslateSettings;

const STORAGE_KEYS = {
  nativeLanguage: "translateNativeLanguage",
  foreignLanguage: "translateForeignLanguage",
  engine: "translateEngine",
} as const;

const promptLanguageTagSet = new Set<string>(PROMPT_LANGUAGE_TAGS);

function getBaseLanguageTag(languageTag: string): string {
  return languageTag.split("-", 1)[0]?.toLowerCase() ?? "";
}

function isPromptLanguageTag(
  languageTag: string | null,
): languageTag is (typeof PROMPT_LANGUAGE_TAGS)[number] {
  return languageTag !== null && promptLanguageTagSet.has(languageTag);
}

export function resolveLanguageTag(input: string): string | null {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) return null;

  const directMatch = LANGUAGE_TAGS.find(
    (languageTag) => languageTag.toLowerCase() === normalizedInput,
  );
  if (directMatch) return directMatch;

  const displayNames = [
    new Intl.DisplayNames(["ja"], { type: "language" }),
    new Intl.DisplayNames(["en"], { type: "language" }),
  ];
  for (const languageTag of LANGUAGE_TAGS) {
    for (const displayName of displayNames) {
      if (
        displayName.of(languageTag)?.trim().toLowerCase() === normalizedInput
      ) {
        return languageTag;
      }
    }
  }

  return null;
}

export function decideDirection(
  detectedLanguage: string | null,
  nativeLanguage: string,
  foreignLanguage: string,
): TranslationDirection {
  if (
    detectedLanguage === null ||
    getBaseLanguageTag(detectedLanguage) === "und"
  ) {
    return {
      sourceLanguage: foreignLanguage,
      targetLanguage: nativeLanguage,
    };
  }

  if (
    getBaseLanguageTag(detectedLanguage) === getBaseLanguageTag(nativeLanguage)
  ) {
    return {
      sourceLanguage: nativeLanguage,
      targetLanguage: foreignLanguage,
    };
  }

  return {
    sourceLanguage: detectedLanguage,
    targetLanguage: nativeLanguage,
  };
}

export function buildTranslationPrompt(
  nativeLanguage: string,
  foreignLanguage: string,
): string {
  return `あなたは翻訳エンジンとして動作する。入力テキストが「${nativeLanguage}」で書かれていれば「${foreignLanguage}」へ、それ以外の言語で書かれていれば「${nativeLanguage}」へ翻訳する。訳文だけを出力し、説明、注釈、引用符を付けない。`;
}

export function buildPromptLanguageOptions(
  nativeLanguage: string,
  foreignLanguage: string,
): PromptLanguageOptions | null {
  const nativeTag = resolveLanguageTag(nativeLanguage);
  const foreignTag = resolveLanguageTag(foreignLanguage);
  if (!isPromptLanguageTag(nativeTag) || !isPromptLanguageTag(foreignTag)) {
    return null;
  }

  const outputLanguages = [nativeTag];
  if (foreignTag !== nativeTag) outputLanguages.push(foreignTag);

  return {
    expectedInputs: [
      {
        type: "text",
        languages: [...PROMPT_LANGUAGE_TAGS],
      },
    ],
    expectedOutputs: [
      {
        type: "text",
        languages: outputLanguages,
      },
    ],
  };
}

export function getStoredTranslateSettings(): TranslateSettings {
  if (typeof localStorage === "undefined") {
    return { ...TRANSLATE_DEFAULTS };
  }

  const storedNativeLanguage = localStorage.getItem(
    STORAGE_KEYS.nativeLanguage,
  );
  const storedForeignLanguage = localStorage.getItem(
    STORAGE_KEYS.foreignLanguage,
  );
  const storedEngine = localStorage.getItem(STORAGE_KEYS.engine);

  return {
    nativeLanguage:
      storedNativeLanguage === null || storedNativeLanguage === ""
        ? TRANSLATE_DEFAULTS.nativeLanguage
        : storedNativeLanguage,
    foreignLanguage:
      storedForeignLanguage === null || storedForeignLanguage === ""
        ? TRANSLATE_DEFAULTS.foreignLanguage
        : storedForeignLanguage,
    engine:
      storedEngine === "translator" || storedEngine === "prompt"
        ? storedEngine
        : TRANSLATE_DEFAULTS.engine,
  };
}

export function setStoredTranslateSettings(settings: TranslateSettings): void {
  if (typeof localStorage === "undefined") return;

  localStorage.setItem(STORAGE_KEYS.nativeLanguage, settings.nativeLanguage);
  localStorage.setItem(STORAGE_KEYS.foreignLanguage, settings.foreignLanguage);
  localStorage.setItem(STORAGE_KEYS.engine, settings.engine);
}

export function splitTranslationUnits(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*(?:\n[ \t]*)+/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}
