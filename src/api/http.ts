/** fetch JSON avec délai maximal et message d'erreur lisible. */
export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = init.signal ? anySignal([init.signal, ctrl.signal]) : ctrl.signal;
  try {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} a répondu ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (ctrl.signal.aborted) throw new Error(`${new URL(url).host} ne répond pas (délai dépassé)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) ctrl.abort();
    else s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
