import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import { cleanupFixtures, describeDb } from "../db-test-helpers";
import { getDb } from "../db";
import { authChallenges, passkeys, users } from "../schema";
import { publicPasskey, recover } from "./passkey-public";
import { manageSecurity, listSecurity } from "./security";
import { authenticator, cookieJar } from "./passkey-test-fixture";
import { beginAuthentication } from "./passkey-webauthn";
import { createSessionToken, verifySessionToken } from "../session";
import { getSessionGeneration } from "./passkey-common";
import { readRecoveryCookie, setRecoveryCookie } from "../passkey-cookies";
import { validateCredentials } from "./auth";

vi.mock("../env", () => ({
  getEnv: () => ({
    WEBAUTHN_RP_ID: "example.test",
    WEBAUTHN_ORIGINS: "https://example.test",
  }),
  getJwtSecret: () => Buffer.alloc(32, 7).toString("base64"),
}));

describeDb("パスキーの認証と復旧の不変条件", () => {
  const ids: number[] = [];
  afterAll(async () => {
    await cleanupFixtures(ids);
  });
  async function begin() {
    const jar = cookieJar();
    const name = `pk${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const key = authenticator();
    const start = await publicPasskey(
      { action: "beginRegister", userId: name },
      jar.cookies,
    );
    if (!start.options || !("user" in start.options))
      throw new Error("登録オプションがない");
    return { jar, name, key, options: start.options };
  }
  async function registered() {
    const fixture = await begin();
    const response = fixture.key.register(fixture.options.challenge);
    const result = await publicPasskey(
      { action: "finishRegister", response },
      fixture.jar.cookies,
    );
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.user, fixture.name));
    ids.push(user.id);
    if (!("codes" in result) || !result.codes)
      throw new Error("復旧コードがない");
    return { ...fixture, user, codes: result.codes, response };
  }
  async function proof(
    fixture: Awaited<ReturnType<typeof registered>>,
    jar = fixture.jar,
  ) {
    const begin = await beginAuthentication(fixture.user.id);
    jar.values.set("__Host-gla-reauth", begin.id);
    return {
      response: fixture.key.authenticate(
        begin.options.challenge,
        fixture.options.user.id,
      ),
    };
  }
  it("パスキーだけで登録し、本人確認・消費済みchallenge・旧パスワードを検証する", async () => {
    const f = await registered();
    expect(f.user.pass_hash).toBeNull();
    await expect(
      publicPasskey(
        { action: "finishRegister", response: f.response },
        f.jar.cookies,
      ),
    ).rejects.toThrow("challenge_expired");
    await expect(
      publicPasskey({ action: "beginRegister", userId: f.name }, f.jar.cookies),
    ).rejects.toThrow("user_id_conflict");
    await manageSecurity(f.user.id, f.jar.cookies, {
      action: "password",
      password: "old-pass",
      proof: await proof(f),
    });
    expect(await validateCredentials(f.name, "old-pass")).not.toBeNull();
    await expect(
      manageSecurity(f.user.id, f.jar.cookies, {
        action: "prepareDisable",
        proof: { password: "old-pass" },
      }),
    ).rejects.toThrow("auth_failed");
    const disableA = await manageSecurity(f.user.id, f.jar.cookies, {
      action: "prepareDisable",
      proof: await proof(f),
    });
    const disableB = await manageSecurity(f.user.id, f.jar.cookies, {
      action: "prepareDisable",
      proof: await proof(f),
    });
    if (
      !disableA.attemptId ||
      !disableB.attemptId ||
      !disableA.codes ||
      !disableB.codes
    )
      throw new Error("無効化用コードがない");
    await expect(
      manageSecurity(f.user.id, f.jar.cookies, {
        action: "confirmDisable",
        attemptId: disableA.attemptId,
        saved: true,
      }),
    ).rejects.toThrow("challenge_expired");
    expect((await listSecurity(f.user.id)).passwordEnabled).toBe(true);
    await manageSecurity(f.user.id, f.jar.cookies, {
      action: "confirmDisable",
      attemptId: disableB.attemptId,
      saved: true,
    });
    await expect(recover(f.name, disableA.codes[0])).rejects.toThrow(
      "recovery_failed",
    );
    await expect(recover(f.name, disableB.codes[0])).resolves.toMatchObject({
      id: f.user.id,
    });
    expect(await validateCredentials(f.name, "old-pass")).toBeNull();
    await expect(
      manageSecurity(f.user.id, f.jar.cookies, {
        action: "delete",
        id: f.key.id,
        proof: await proof(f),
      }),
    ).rejects.toThrow("last_passkey");
    await expect(
      manageSecurity(f.user.id, f.jar.cookies, {
        action: "codes",
        proof: { password: "old-pass" },
      }),
    ).rejects.toThrow("auth_failed");
  });
  it("誤ったorigin・RP IDと期限切れではアカウントを作らず、登録同時送信は1回だけ成功する", async () => {
    const f = await begin();
    for (const response of [
      f.key.register(f.options.challenge, "https://evil.test"),
      f.key.register(f.options.challenge, "https://example.test", "evil.test"),
    ]) {
      await expect(
        publicPasskey({ action: "finishRegister", response }, f.jar.cookies),
      ).rejects.toThrow("auth_failed");
    }
    expect(
      await getDb().select().from(users).where(eq(users.user, f.name)),
    ).toHaveLength(0);
    const attempt = f.jar.values.get("__Host-gla-register")!;
    await getDb()
      .update(authChallenges)
      .set({ expires: new Date(Date.now() - 1000) })
      .where(eq(authChallenges.id, attempt));
    await expect(
      publicPasskey(
        {
          action: "finishRegister",
          response: f.key.register(f.options.challenge),
        },
        f.jar.cookies,
      ),
    ).rejects.toThrow("challenge_expired");
    const fresh = await begin();
    const response = fresh.key.register(fresh.options.challenge);
    const results = await Promise.allSettled([
      publicPasskey({ action: "finishRegister", response }, fresh.jar.cookies),
      publicPasskey({ action: "finishRegister", response }, fresh.jar.cookies),
    ]);
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.user, fresh.name));
    ids.push(user.id);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await getDb()
        .select()
        .from(passkeys)
        .where(eq(passkeys.user_id, user.id)),
    ).toHaveLength(1);
  });
  it("別アカウントの資格情報・user handle・origin・RP IDを拒否する", async () => {
    const a = await registered();
    const b = await registered();
    for (const response of [
      a.key.authenticate("wrong-challenge", a.options.user.id),
      a.key.authenticate("unused", b.options.user.id),
    ]) {
      const begin = await beginAuthentication(a.user.id);
      a.jar.values.set("__Host-gla-reauth", begin.id);
      await expect(
        manageSecurity(a.user.id, a.jar.cookies, {
          action: "codes",
          proof: { response },
        }),
      ).rejects.toThrow("auth_failed");
    }
    const begin = await beginAuthentication(b.user.id);
    b.jar.values.set("__Host-gla-reauth", begin.id);
    await expect(
      manageSecurity(b.user.id, b.jar.cookies, {
        action: "codes",
        proof: {
          response: a.key.authenticate(
            begin.options.challenge,
            a.options.user.id,
          ),
        },
      }),
    ).rejects.toThrow("auth_failed");
    for (const [origin, rp] of [
      ["https://evil.test", "example.test"],
      ["https://example.test", "evil.test"],
    ]) {
      const start = await beginAuthentication(a.user.id);
      a.jar.values.set("__Host-gla-reauth", start.id);
      await expect(
        manageSecurity(a.user.id, a.jar.cookies, {
          action: "codes",
          proof: {
            response: a.key.authenticate(
              start.options.challenge,
              a.options.user.id,
              origin,
              rp,
            ),
          },
        }),
      ).rejects.toThrow("auth_failed");
    }
  });
  it("復旧コードを同時消費できず、復旧状態は登録だけを許し、完了で旧資格情報・コード・セッションを失効する", async () => {
    const f = await registered();
    const oldSession = await createSessionToken(f.user.id);
    const results = await Promise.allSettled([
      recover(f.name, f.codes[0]),
      recover(f.name, f.codes[0]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(recover(f.name, f.codes[0])).rejects.toThrow(
      "recovery_failed",
    );
    await setRecoveryCookie(f.jar.cookies, f.user.id, 0);
    expect(
      await verifySessionToken(
        f.jar.values.get("__Host-gla-recovery")!,
        getSessionGeneration,
      ),
    ).toBeNull();
    await expect(readRecoveryCookie(cookieJar().cookies)).rejects.toThrow(
      "auth_failed",
    );
    const start = await publicPasskey(
      { action: "beginRecovery" },
      f.jar.cookies,
    );
    if (!start.options || !("user" in start.options))
      throw new Error("登録オプションがない");
    // 取消後も同じ短期状態で新しい試行を開始できる。
    const retry = await publicPasskey(
      { action: "beginRecovery" },
      f.jar.cookies,
    );
    if (!retry.options || !("user" in retry.options))
      throw new Error("登録オプションがない");
    const next = authenticator();
    await publicPasskey(
      {
        action: "finishRecovery",
        response: next.register(retry.options.challenge),
      },
      f.jar.cookies,
    );
    expect(
      await verifySessionToken(oldSession, getSessionGeneration),
    ).toBeNull();
    expect(
      await getDb()
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.user_id, f.user.id), eq(passkeys.id, f.key.id))),
    ).toHaveLength(0);
    await expect(recover(f.name, f.codes[1])).rejects.toThrow(
      "recovery_failed",
    );
    expect(
      await verifySessionToken(
        f.jar.values.get("__Host-gla-session")!,
        getSessionGeneration,
      ),
    ).toBe(f.user.id);
    const login = await publicPasskey({ action: "beginLogin" }, f.jar.cookies);
    if (!login.options) throw new Error("認証オプションがない");
    await publicPasskey(
      {
        action: "finishLogin",
        response: next.authenticate(
          login.options.challenge,
          retry.options.user.id,
        ),
      },
      f.jar.cookies,
    );
  });
  it("同時削除でも認証手段を残し、別ブラウザーのchallengeと再発行前の復旧コードを拒否する", async () => {
    const f = await registered();
    const second = authenticator();
    const add = await manageSecurity(f.user.id, f.jar.cookies, {
      action: "beginAdd",
      proof: await proof(f),
    });
    if (!add.options) throw new Error("登録オプションがない");
    await expect(
      manageSecurity(f.user.id, cookieJar().cookies, {
        action: "finishAdd",
        response: second.register(add.options.challenge),
        name: "予備",
      }),
    ).rejects.toThrow("challenge_expired");
    await manageSecurity(f.user.id, f.jar.cookies, {
      action: "finishAdd",
      response: second.register(add.options.challenge),
      name: "予備",
    });
    const firstJar = cookieJar();
    const secondJar = cookieJar();
    const firstProof = await proof(f, firstJar);
    const secondProof = await proof(f, secondJar);
    const deleted = await Promise.allSettled([
      manageSecurity(f.user.id, firstJar.cookies, {
        action: "delete",
        id: f.key.id,
        proof: firstProof,
      }),
      manageSecurity(f.user.id, secondJar.cookies, {
        action: "delete",
        id: second.id,
        proof: secondProof,
      }),
    ]);
    expect(deleted.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listSecurity(f.user.id)).passkeys).toHaveLength(1);
    const password = "temporary-pass";
    // 残った認証器を使う。削除結果から所有している鍵だけを選ぶ。
    const [remaining] = await getDb()
      .select()
      .from(passkeys)
      .where(eq(passkeys.user_id, f.user.id));
    const key = remaining.id === f.key.id ? f.key : second;
    const start = await beginAuthentication(f.user.id);
    f.jar.values.set("__Host-gla-reauth", start.id);
    await manageSecurity(f.user.id, f.jar.cookies, {
      action: "password",
      password,
      proof: {
        response: key.authenticate(start.options.challenge, f.options.user.id),
      },
    });
    await manageSecurity(f.user.id, f.jar.cookies, {
      action: "codes",
      proof: { password },
    });
    await expect(recover(f.name, f.codes[0])).rejects.toThrow(
      "recovery_failed",
    );
  });
  it("復旧の連続失敗10回で15分拒否し、期限後は未使用コードを受け付ける", async () => {
    const f = await registered();
    for (let i = 0; i < 10; i++)
      await expect(recover(f.name, "invalid")).rejects.toThrow(
        "recovery_failed",
      );
    await expect(recover(f.name, f.codes[0])).rejects.toThrow(
      "recovery_failed",
    );
    const [locked] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, f.user.id));
    expect(
      locked.recovery_locked_until!.getTime() - Date.now(),
    ).toBeGreaterThan(890_000);
    await getDb()
      .update(users)
      .set({ recovery_locked_until: new Date(Date.now() - 1000) })
      .where(eq(users.id, f.user.id));
    await expect(recover(f.name, f.codes[0])).resolves.toMatchObject({
      id: f.user.id,
    });
  });
});
