/** ブラウザ内蔵AIの有無と共有作成・置換・解放を所有する */

type ModelInstances = {
  detector: LanguageDetector;
  translator: Translator;
  prompt: LanguageModel;
};
type ModelApis = {
  detector: typeof globalThis.LanguageDetector;
  translator: typeof globalThis.Translator;
  prompt: typeof globalThis.LanguageModel;
};
type SharedCreation<T> = {
  generation: number;
  controller: AbortController;
  promise: Promise<T>;
  reject: (reason: DOMException) => void;
};
type ModelSlot<T> = {
  resource?: { key: string; instance: T };
  creations: Map<string, SharedCreation<T>>;
  sequence: number;
};

function makeSlot<T>(): ModelSlot<T> {
  return { creations: new Map(), sequence: 0 };
}

export const modelSlots: {
  [K in keyof ModelInstances]: ModelSlot<ModelInstances[K]>;
} = {
  detector: makeSlot<LanguageDetector>(),
  translator: makeSlot<Translator>(),
  prompt: makeSlot<LanguageModel>(),
};

let resourceGeneration = 0;
export function getResourceGeneration(): number {
  return resourceGeneration;
}

export function getModelApi<K extends keyof ModelApis>(kind: K): ModelApis[K] {
  const apis: ModelApis = {
    detector: globalThis.LanguageDetector,
    translator: globalThis.Translator,
    prompt: globalThis.LanguageModel,
  };
  return apis[kind];
}
function makePreparationAbortError(): DOMException {
  return new DOMException("翻訳準備が中断されました", "AbortError");
}

export function ensurePreparationActive(
  generation: number,
  signal?: AbortSignal,
): void {
  if (generation !== resourceGeneration || signal?.aborted) {
    throw makePreparationAbortError();
  }
}

/**
 * 外部APIの中断信号受理に依存せず、共有作成の待機と登録を所有する。
 * 放棄後に外部作成が完了した場合は、採用せず作成物を解放する。
 */
function getOrCreateShared<T extends { destroy(): void }>(
  creations: Map<string, SharedCreation<T>>,
  key: string,
  generation: number,
  create: (signal: AbortSignal) => PromiseLike<T> | T,
  adopt: (instance: T) => boolean,
): Promise<T> {
  const existing = creations.get(key);
  if (existing?.generation === generation) return existing.promise;

  const controller = new AbortController();
  let resolveCreation!: (instance: T) => void;
  let rejectCreation!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveCreation = resolve;
    rejectCreation = reject;
  });
  const creation: SharedCreation<T> = {
    generation,
    controller,
    promise,
    reject: rejectCreation,
  };
  creations.set(key, creation);

  try {
    const externalCreation = create(controller.signal);
    void Promise.resolve(externalCreation).then(
      (instance) => {
        if (creations.get(key) !== creation || !adopt(instance)) {
          instance.destroy();
          rejectCreation(makePreparationAbortError());
          return;
        }
        resolveCreation(instance);
      },
      (error: unknown) => rejectCreation(error),
    );
  } catch (error) {
    rejectCreation(error);
  }
  void promise.then(
    () => {
      if (creations.get(key) === creation) creations.delete(key);
    },
    () => {
      if (creations.get(key) === creation) creations.delete(key);
    },
  );
  return promise;
}

function abandonSharedCreations(
  creations: {
    values(): Iterable<{
      reject(reason: DOMException): void;
      controller: AbortController;
    }>;
    clear(): void;
  },
  reason: DOMException,
): void {
  for (const creation of creations.values()) {
    creation.reject(reason);
    creation.controller.abort(reason);
  }
  creations.clear();
}

/** 同じ種類・キーの作成を共有し、最新の置換だけを採用する */
export function createSharedModel<K extends keyof ModelInstances>(
  kind: K,
  key: string,
  create: (
    signal: AbortSignal,
  ) => PromiseLike<ModelInstances[K]> | ModelInstances[K],
  generation = resourceGeneration,
  signal?: AbortSignal,
): Promise<ModelInstances[K]> {
  ensurePreparationActive(generation, signal);
  // 種類とインスタンス型の対応はmodelSlotsの定義で固定する。
  const slot: ModelSlot<ModelInstances[K]> = modelSlots[kind];
  if (slot.resource?.key === key)
    return Promise.resolve(slot.resource.instance);
  const existing = slot.creations.get(key);
  if (existing?.generation === generation) return existing.promise;
  const sequence = ++slot.sequence;
  return getOrCreateShared(
    slot.creations,
    key,
    generation,
    create,
    (instance) => {
      if (sequence !== slot.sequence) return false;
      const previous = slot.resource?.instance;
      slot.resource = { key, instance };
      if (previous !== instance) previous?.destroy();
      return true;
    },
  );
}

/** 要求の中断とは分けて、準備対象の変更時に共有作成を放棄する */
export function abandonEngineCreations(): void {
  resourceGeneration += 1;
  const reason = makePreparationAbortError();
  for (const slot of Object.values(modelSlots)) {
    slot.sequence += 1;
    abandonSharedCreations(slot.creations, reason);
  }
}

export function destroyTranslationResources(): void {
  abandonEngineCreations();
  for (const slot of Object.values(modelSlots)) {
    slot.resource?.instance.destroy();
    slot.resource = undefined;
  }
}
