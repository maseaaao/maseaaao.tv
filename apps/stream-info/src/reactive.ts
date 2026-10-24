/**
 * Минимальный реактивный слой приложения: глубокие прокси-объекты, изменение
 * которых запускает выкладку DOM одним проходом. Планирование — микротаска,
 * поэтому пакет изменений из одного обработчика рендерится один раз.
 * Публичных подписок нет: DOM-привязки в render.ts и тесты читают состояние
 * напрямую, повторная выкладка идемпотентна.
 */

type Listener = () => void;

const proxies = new WeakMap<object, object>();
const listeners = new Set<Listener>();
let scheduled = false;

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const listener of [...listeners]) listener();
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function wrap(value: unknown): unknown {
  // Оборачиваются только простые объекты и массивы: Date, Set, DOM и классы
  // клиентов остаются исходными значениями.
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return reactive(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return reactive(value as Record<string, unknown>);
}

export function reactive<T extends object>(source: T): T {
  const cached = proxies.get(source);
  if (cached) return cached as T;
  const proxy = new Proxy<Record<PropertyKey, unknown>>(source as never, {
    get(_target, key, receiver) {
      return wrap(Reflect.get(source, key, receiver));
    },
    set(_target, key, value, receiver) {
      if (Reflect.get(source, key, receiver) === value) return true;
      const ok = Reflect.set(source, key, value, receiver);
      schedule();
      return ok;
    },
    deleteProperty(_target, key) {
      schedule();
      return Reflect.deleteProperty(source, key);
    },
  });
  proxies.set(source, proxy);
  return proxy as T;
}
