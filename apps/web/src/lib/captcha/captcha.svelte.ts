import type { AltchaWidgetElement } from 'altcha/types/generic';

/** Tope de espera tras pulsar Enviar (UX de captcha §3.4, decisión 3 del CTO). */
export const CAPTCHA_WAIT_MS = 20_000;

/**
 * Estado de la comprobación antibots de un formulario (técnico de captcha §8.1). Lo crea la
 * página, lo pinta `CaptchaField` y lo espera `createSubmission({ captcha })`.
 */
export function createCaptcha() {
  let element = $state<AltchaWidgetElement | undefined>();
  let widgetState = $state<string>('unverified');
  /** El reto caducó: el widget vuelve a reposo y se repite solo al enviar (UX §3.5). */
  let expired = $state(false);
  /** Se pasó el tope de espera tras pulsar Enviar: `CaptchaField` lo anuncia (UX §3.4, paso 6). */
  let timedOut = $state(false);
  /** `CaptchaField` está en la página con JavaScript (aunque el widget aún se esté cargando). */
  let mounted = $state(false);
  // Solo guarda funciones a las que avisar: no es estado que se pinte.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const waiters = new Set<(state: string) => void>();

  /** La solución que el widget anunció con su último cambio de estado. */
  let lastPayload = '';
  const payload = (): string => lastPayload;

  function onStateChange(event: Event): void {
    const { state, payload: value } = (event as CustomEvent<{ state: string; payload?: string }>)
      .detail;
    widgetState = state;
    lastPayload = value ?? '';
    if (state === 'verifying') expired = false;
    if (state === 'verified') timedOut = false;
    for (const waiter of waiters) waiter(state);
  }

  function onExpired(): void {
    // Sin el aviso del widget (un `role="alert"`): caducar no es un error (UX §4.1).
    element?.reset?.();
    expired = true;
  }

  /** Espera a que termine el cálculo en curso o a que pase el tope. */
  function settle(timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      const done = (state: string) => {
        if (state !== 'verified' && state !== 'error' && state !== 'timeout') return;
        clearTimeout(timer);
        waiters.delete(done);
        resolve(state);
      };
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      waiters.add(done);
    });
  }

  return {
    get element() {
      return element;
    },
    set element(value: AltchaWidgetElement | undefined) {
      element = value;
    },
    get state() {
      return widgetState;
    },
    get expired() {
      return expired;
    },
    get timedOut() {
      return timedOut;
    },
    /**
     * El formulario lleva la comprobación y hay JavaScript. El widget puede no haber terminado de
     * cargar: un envío en ese momento también espera.
     */
    get active() {
      return mounted;
    },
    /** Lo llama `CaptchaField` al montarse. Devuelve la limpieza. */
    mount(): () => void {
      mounted = true;
      return () => {
        mounted = false;
        element = undefined;
      };
    },
    /** Comprobado y con la solución en el campo oculto: se puede enviar. */
    get ready() {
      return widgetState === 'verified' && payload() !== '';
    },
    /** Engancha los eventos del widget. Devuelve la limpieza. */
    attach(widget: AltchaWidgetElement): () => void {
      // Los métodos del elemento existen cuando su componente interno se ha montado (un
      // microtask después de conectarlo): hasta entonces está en reposo.
      widgetState = widget.getState?.() ?? 'unverified';
      lastPayload = '';
      widget.addEventListener('statechange', onStateChange);
      widget.addEventListener('expired', onExpired);
      return () => {
        widget.removeEventListener('statechange', onStateChange);
        widget.removeEventListener('expired', onExpired);
      };
    },
    /**
     * `true` si la comprobación queda hecha. Si está calculando, espera; si no, la lanza. Con el
     * tope de 20 s, la trata como un fallo del widget.
     */
    async ensureVerified(timeoutMs = CAPTCHA_WAIT_MS): Promise<boolean> {
      const started = Date.now();
      // Con el widget aún cargando, se espera a que exista y tenga sus métodos.
      const widget = await until(() => (element?.getState ? element : undefined), timeoutMs);
      if (!widget) {
        timedOut = true;
        return false;
      }
      timeoutMs = Math.max(0, timeoutMs - (Date.now() - started));
      if (widgetState === 'verified' && payload() !== '') return true;
      const result = settle(timeoutMs);
      if (widget.getState?.() !== 'verifying') void widget.verify?.();
      const state = await result;
      if (state === 'timeout') {
        // Se para el cálculo y la casilla queda para reintentar; el texto lo pone CaptchaField,
        // porque el error del widget no distingue el tope (captcha.error.tiempo).
        // Sin `auto`: llevar el foco a la casilla no debe volver a lanzar el cálculo; se reintenta
        // al marcarla, como dice el aviso.
        void widget.configure?.({ auto: 'off' });
        widget.reset?.();
        timedOut = true;
      }
      return state === 'verified' && payload() !== '';
    },
    /** La casilla del widget, para llevarle el foco. */
    checkbox(): HTMLInputElement | null {
      return element?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
    },
  };
}

export type Captcha = ReturnType<typeof createCaptcha>;

/** El primer valor que da `read`, o `undefined` si pasa `timeoutMs`. */
async function until<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined || Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
