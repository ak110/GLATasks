/**
 * @fileoverview 翻訳設定と方向判定のユニットテスト
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPromptLanguageOptions,
  buildTranslationPrompt,
  decideDirection,
  getStoredTranslateSettings,
  LANGUAGE_TAGS,
  PROMPT_LANGUAGE_TAGS,
  resolveLanguageTag,
  setStoredTranslateSettings,
  TRANSLATE_DEFAULTS,
} from "./translate";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", localStorageMock);
});

describe("resolveLanguageTag", () => {
  it.each([
    ["英語", "en"],
    ["English", "en"],
    ["en", "en"],
    ["EN", "en"],
    ["  ja  ", "ja"],
    ["フランス語", "fr"],
    ["zh-Hant", "zh-Hant"],
    ["存在しない言語", null],
  ] as const)("%s を %s へ解決する", (input, expected) => {
    expect(resolveLanguageTag(input)).toBe(expected);
  });

  it("Translator APIの候補タグを保持する", () => {
    expect(LANGUAGE_TAGS).toContain("zh-Hant");
  });
});

describe("decideDirection", () => {
  it("母語と一致する検出結果は相手言語へ訳す", () => {
    expect(decideDirection("en-US", "en", "ja")).toEqual({
      sourceLanguage: "en",
      targetLanguage: "ja",
    });
  });

  it("母語と一致しない検出結果は母語へ訳す", () => {
    expect(decideDirection("en", "ja", "en")).toEqual({
      sourceLanguage: "en",
      targetLanguage: "ja",
    });
  });

  it.each([null, "und"])(
    "検出不能な %s は相手言語から母語へ訳す",
    (detectedLanguage) => {
      expect(decideDirection(detectedLanguage, "ja", "en")).toEqual({
        sourceLanguage: "en",
        targetLanguage: "ja",
      });
    },
  );
});

describe("buildTranslationPrompt", () => {
  it("言語と訳文だけを出力する制約を含める", () => {
    const prompt = buildTranslationPrompt("日本語", "英語");
    expect(prompt).toContain("日本語");
    expect(prompt).toContain("英語");
    expect(prompt).toContain("訳文だけを出力");
    expect(prompt).toContain("説明、注釈、引用符を付けない");
  });
});

describe("buildPromptLanguageOptions", () => {
  it("対応言語全体を入力、設定言語を出力へ指定する", () => {
    expect(buildPromptLanguageOptions("ja", "en")).toEqual({
      expectedInputs: [{ type: "text", languages: [...PROMPT_LANGUAGE_TAGS] }],
      expectedOutputs: [{ type: "text", languages: ["ja", "en"] }],
    });
    expect(buildPromptLanguageOptions("en", "fr")).toEqual({
      expectedInputs: [{ type: "text", languages: [...PROMPT_LANGUAGE_TAGS] }],
      expectedOutputs: [{ type: "text", languages: ["en", "fr"] }],
    });
  });

  it.each([
    ["ja", "中国語"],
    ["ja", "存在しない言語"],
  ] as const)("%s と %s はPrompt APIの設定を生成しない", (native, foreign) => {
    expect(buildPromptLanguageOptions(native, foreign)).toBeNull();
  });
});

describe("translate settings", () => {
  it("未保存時は既定値を返す", () => {
    expect(getStoredTranslateSettings()).toEqual(TRANSLATE_DEFAULTS);
  });

  it("未知のエンジン値は既定値へ戻す", () => {
    storage.set("translateEngine", "unknown");
    expect(getStoredTranslateSettings().engine).toBe(TRANSLATE_DEFAULTS.engine);
  });

  it("保存した母語・相手言語・エンジンを読み取る", () => {
    const settings = {
      nativeLanguage: "English",
      foreignLanguage: "フランス語",
      engine: "prompt" as const,
    };
    setStoredTranslateSettings(settings);
    expect(getStoredTranslateSettings()).toEqual(settings);
  });
});
