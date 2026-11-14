// Tipos globales de la app: https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** Persona con sesión válida, o `null`. `emailVerified`: para la banda de la cabecera. */
      user: { id: string; email: string; emailVerified: boolean } | null;
      /** Token de la cookie. Solo vive en el servidor: nunca se devuelve en `data` ni en `form`. */
      sessionToken: string | null;
      /** `true` si no se pudo comprobar la sesión porque la API no respondió. */
      sessionUnavailable: boolean;
    }
  }
}

export {};
