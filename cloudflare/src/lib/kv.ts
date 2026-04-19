import type { Env } from "../env";

// Netlify Blobs → Workers KV adapter.
// Original code used `getStore("darvis-memory").get("all", { type: "json" })`.
// We collapse that into a single KV namespace with colon-delimited keys so
// the user only has to create and bind one KV namespace.
//
// Store names map 1:1 with the old Netlify Blobs store names, minus the
// "darvis-" prefix (e.g. "darvis-memory" → "memory").

export function storeKey(store: string, key: string): string {
  const short = store.startsWith("darvis-") ? store.slice(7) : store;
  return `${short}:${key}`;
}

export async function kvGetJSON<T = unknown>(env: Env, store: string, key: string): Promise<T | null> {
  try {
    return (await env.KV.get(storeKey(store, key), { type: "json" })) as T | null;
  } catch {
    return null;
  }
}

export async function kvGetText(env: Env, store: string, key: string): Promise<string | null> {
  try {
    return await env.KV.get(storeKey(store, key));
  } catch {
    return null;
  }
}

export async function kvGetArrayBuffer(env: Env, store: string, key: string): Promise<ArrayBuffer | null> {
  try {
    return await env.KV.get(storeKey(store, key), { type: "arrayBuffer" });
  } catch {
    return null;
  }
}

export async function kvSetJSON(env: Env, store: string, key: string, value: unknown, opts?: { expirationTtl?: number }): Promise<void> {
  await env.KV.put(storeKey(store, key), JSON.stringify(value), opts);
}

export async function kvSetText(env: Env, store: string, key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
  await env.KV.put(storeKey(store, key), value, opts);
}

export async function kvSetArrayBuffer(env: Env, store: string, key: string, value: ArrayBuffer, opts?: { expirationTtl?: number }): Promise<void> {
  await env.KV.put(storeKey(store, key), value, opts);
}

export async function kvDelete(env: Env, store: string, key: string): Promise<void> {
  await env.KV.delete(storeKey(store, key));
}

export async function kvList(env: Env, store: string, prefix?: string): Promise<{ name: string; expiration?: number }[]> {
  const base = storeKey(store, prefix || "");
  const out: { name: string; expiration?: number }[] = [];
  let cursor: string | undefined;
  do {
    const res = await env.KV.list({ prefix: base, cursor });
    for (const k of res.keys) {
      const storePart = storeKey(store, "");
      out.push({ name: k.name.slice(storePart.length), expiration: k.expiration });
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}

// Minimal shim so ported Netlify code that says `const s = getStore("x")` can
// keep that shape. Thin wrapper over the functions above.
export function getStore(env: Env, store: string) {
  return {
    get: (key: string, opts?: { type?: "json" | "text" | "arrayBuffer" }) => {
      const type = opts?.type;
      if (type === "arrayBuffer") return kvGetArrayBuffer(env, store, key);
      if (type === "text") return kvGetText(env, store, key);
      return kvGetJSON(env, store, key);
    },
    set: (key: string, value: string | ArrayBuffer) => {
      if (typeof value === "string") return kvSetText(env, store, key, value);
      return kvSetArrayBuffer(env, store, key, value);
    },
    setJSON: (key: string, value: unknown) => kvSetJSON(env, store, key, value),
    delete: (key: string) => kvDelete(env, store, key),
    list: (prefix?: string) => kvList(env, store, prefix),
  };
}
