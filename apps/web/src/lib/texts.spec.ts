import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { texts } from './texts.ts';

/**
 * Criterio de aceptación 49 de UX: todos los textos visibles coinciden palabra por palabra con la
 * tabla de §5, sin textos fuera de ella. Se lee la tabla del propio documento de diseño.
 */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const uxDoc = readFileSync(resolve(REPO_ROOT, 'docs/h0-diseno-ux.md'), 'utf8');
const oauthUxDoc = readFileSync(resolve(REPO_ROOT, 'docs/login-terceros-diseno-ux.md'), 'utf8');

/** Filas `| `clave` | texto |` de la sección 5. Un texto entre acentos graves se toma literal (con sus espacios). */
function tableOfSection5(doc = uxDoc, endHeading = '## 6. Accesibilidad'): Map<string, string> {
  const start = doc.indexOf('## 5. Textos de interfaz');
  const end = doc.indexOf(endHeading);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const rows = new Map<string, string>();
  for (const line of doc.slice(start, end).split('\n')) {
    const match = /^\| `([a-z0-9_.]+)` \| (.*) \|$/.exec(line);
    if (!match) continue;
    const [, key, cell] = match as unknown as [string, string, string];
    const literal = /^`(.*)`$/.exec(cell);
    rows.set(key, literal ? (literal[1] ?? '') : cell);
  }
  return rows;
}

const table = tableOfSection5();
/** Tabla del diseño UX de la entrada con Google y Facebook (sus §5.1 a §5.8). */
const oauthTable = tableOfSection5(oauthUxDoc, '## 6. Responsive y accesibilidad');

describe('Textos de interfaz = tabla de UX §5 (criterio 49)', () => {
  it('se ha leído la tabla entera (no pasa por no encontrar nada)', () => {
    expect(table.size).toBeGreaterThan(100);
    expect(table.get('registro.boton.enviar')).toBe('Crear cuenta');
    expect(oauthTable.size).toBeGreaterThan(100);
    expect(oauthTable.get('proveedor.boton.google')).toBe('Continuar con Google');
  });

  it('las dos tablas no se contradicen: una clave repetida tiene el mismo texto', () => {
    // Salvo las condiciones de uso: la versión nueva cambia esas secciones a propósito (§5.9).
    const conflicts = [...oauthTable].filter(
      ([key, text]) => !key.startsWith('condiciones.') && table.has(key) && table.get(key) !== text,
    );
    expect(conflicts).toEqual([]);
  });

  it('cada clave de texts.ts existe en una de las tablas con exactamente el mismo texto', () => {
    const different: string[] = [];
    for (const [key, text] of Object.entries(texts)) {
      const expected = table.get(key) ?? oauthTable.get(key);
      if (expected === undefined) different.push(`${key}: no está en ninguna tabla de UX §5`);
      else if (expected !== text) different.push(`${key}: «${text}» ≠ «${expected}»`);
    }
    expect(different).toEqual([]);
  });

  it('cada clave de las dos tablas (salvo /legal/terms) está en texts.ts: no falta ningún texto', () => {
    const missing = [...table.keys(), ...oauthTable.keys()].filter(
      (key) => !key.startsWith('condiciones.') && !(key in texts),
    );
    expect(missing).toEqual([]);
  });
});

/** Una sola línea, sin etiquetas ni saltos: así se compara el texto aunque Prettier lo reparta. */
const flat = (value: string): string =>
  value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const legal = (file: string): string =>
  readFileSync(resolve(REPO_ROOT, `apps/web/src/lib/legal/${file}`), 'utf8');

/**
 * Cada versión de las condiciones coincide con su tabla: la de H0 (`2026-11-borrador`, que se
 * conserva como registro de lo aceptado) y la de H0 con las secciones que cambia la entrada con
 * terceros (`2026-11-borrador-2`, vigente).
 */
const versions = [
  { file: 'terms-2026-11-borrador.svelte', rows: table },
  {
    file: 'terms-2026-11-borrador-2.svelte',
    rows: new Map([...table, ...[...oauthTable].filter(([key]) => key.startsWith('condiciones.'))]),
  },
];

describe.each(versions)('Condiciones de uso: $file = UX §5.9', ({ file, rows }) => {
  const terms = legal(file);
  const page = flat(terms);
  const keys = [...rows.keys()].filter((key) => key.startsWith('condiciones.'));

  it('hay textos de §5.9 que comprobar', () => {
    expect(keys.length).toBeGreaterThanOrEqual(21);
  });

  it.each(
    keys.filter((key) => !['condiciones.meta.titulo', 'condiciones.enlace.volver'].includes(key)),
  )('%s aparece tal cual en el texto legal', (key) => {
    expect(page).toContain(flat(rows.get(key) ?? '«falta»'));
  });

  it('el <title> es el de condiciones.meta.titulo con el sufijo de marca', () => {
    const title = /<title>([^<]*)<\/title>/.exec(terms)?.[1];
    expect(title).toBe(`${rows.get('condiciones.meta.titulo')}${texts['comun.meta.sufijo']}`);
  });
});

describe('/legal/terms muestra la versión vigente', () => {
  it('la página importa el archivo de SERVICE_TERMS_VERSION', () => {
    const route = readFileSync(
      resolve(REPO_ROOT, 'apps/web/src/routes/legal/terms/+page.svelte'),
      'utf8',
    );
    expect(route).toContain(`terms-${SERVICE_TERMS_VERSION}.svelte`);
    expect(flat(legal(`terms-${SERVICE_TERMS_VERSION}.svelte`))).toContain(
      `Versión ${SERVICE_TERMS_VERSION}`,
    );
  });
});
