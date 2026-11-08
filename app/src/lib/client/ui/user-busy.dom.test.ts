/**
 * @fileoverview 作業中判定のうち、フォーカスが外れた後も残る未保存の入力の扱いのユニットテスト
 *
 * フォーカスとダイアログによる判定は`connection-recovery.svelte.test.ts`が検証する。
 * ここでは利用者が入力した欄の追跡（値の有無・送信後の扱い・未保存の入力が無いとみなす値との比較・画面からの除去・対象の種類）と、
 * `holdUnsavedDraft`による申告を検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UserBusy = typeof import("#lib/client/ui/user-busy.ts");

/** 欄を追加して利用者の入力を模し、フォーカスを外す */
function typeInto(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.blur();
}

describe("isUserBusy（未保存の入力）", () => {
  let userBusy: UserBusy;
  let stopTracking: () => void;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = "";
    userBusy = await import("#lib/client/ui/user-busy.ts");
    stopTracking = userBusy.startEditedFieldTracking();
  });

  afterEach(() => {
    stopTracking();
    document.body.innerHTML = "";
  });

  it("入力した欄に値が残る間は、フォーカスが外れていても作業中とみなし、値を消すと作業中でなくなる", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    typeInto(textarea, "未保存の本文");
    expect(document.activeElement).not.toBe(textarea);
    expect(userBusy.isUserBusy()).toBe(true);

    textarea.value = "";
    expect(userBusy.isUserBusy()).toBe(false);
  });

  it("入力のない欄に値があるだけでは作業中とみなさない", () => {
    const input = document.createElement("input");
    input.value = "初期値";
    document.body.appendChild(input);

    expect(userBusy.isUserBusy()).toBe(false);
  });

  it("フォームを送信しても、値が残る間は作業中とみなす（保存に失敗して入力が残る場合を保護する）", () => {
    const form = document.createElement("form");
    const textarea = document.createElement("textarea");
    form.appendChild(textarea);
    document.body.appendChild(form);

    typeInto(textarea, "保存に失敗した本文");
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(userBusy.isUserBusy()).toBe(true);

    // 保存に成功して部品が入力を消すと作業中でなくなる
    textarea.value = "";
    expect(userBusy.isUserBusy()).toBe(false);
  });

  it("未保存の入力が無いとみなす値を示す欄は、値がその値と異なる間だけ作業中とみなす", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = "2000";
    input.dataset.cleanValue = "2000";
    document.body.appendChild(input);

    typeInto(input, "1800");
    expect(userBusy.isUserBusy()).toBe(true);

    // 保存に成功すると部品が示す値を保存した値へ更新し、値が欄に残っていても作業中でなくなる
    input.dataset.cleanValue = "1800";
    expect(userBusy.isUserBusy()).toBe(false);

    // 示す値を空にした変更も未保存の入力として扱う
    typeInto(input, "");
    expect(userBusy.isUserBusy()).toBe(true);
  });

  it("入力した欄が画面から除かれると作業中とみなさない", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    typeInto(input, "閉じた編集欄");
    input.remove();
    expect(userBusy.isUserBusy()).toBe(false);
  });

  it("チェックボックスの操作は追跡しない", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = "on";
    document.body.appendChild(checkbox);

    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    expect(userBusy.isUserBusy()).toBe(false);
  });

  it("holdUnsavedDraftで申告した間は作業中とみなし、取り消すと作業中でなくなる", () => {
    const release = userBusy.holdUnsavedDraft();
    expect(userBusy.isUserBusy()).toBe(true);

    release();
    expect(userBusy.isUserBusy()).toBe(false);
  });
});
