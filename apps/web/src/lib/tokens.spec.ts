import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Criterios 42 y 54 de UX: contrastes calculados con la fórmula de WCAG a partir de los tokens
 * reales de `app.css`, y ningún color «a mano» fuera de los tokens.
 */
const SRC = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(SRC, 'app.css'), 'utf8');

const tokens = Object.fromEntries(
  [...css.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [
    match[1] as string,
    match[2] as string,
  ]),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const token = (name: string): string => {
  const value = tokens[name];
  if (!value) throw new Error(`Falta el token ${name} en app.css`);
  return value;
};

// [descripción, primer plano, fondo, mínimo]. Texto normal 4,5; bordes, iconos y foco 3.
const PAIRS: [string, string, string, number][] = [
  ['texto sobre fondo', 'color-texto', 'color-fondo', 4.5],
  ['texto sobre superficie', 'color-texto', 'color-superficie', 4.5],
  ['texto suave (ayudas) sobre fondo', 'color-texto-suave', 'color-fondo', 4.5],
  ['texto suave (pie) sobre superficie', 'color-texto-suave', 'color-superficie', 4.5],
  ['enlaces (primario) sobre fondo', 'color-primario', 'color-fondo', 4.5],
  ['enlaces (primario) sobre superficie', 'color-primario', 'color-superficie', 4.5],
  ['enlaces en hover sobre fondo', 'color-primario-hover', 'color-fondo', 4.5],
  ['texto blanco sobre botón primario', 'color-sobre-primario', 'color-primario', 4.5],
  [
    'texto blanco sobre botón primario en hover',
    'color-sobre-primario',
    'color-primario-hover',
    4.5,
  ],
  ['texto blanco sobre botón de peligro', 'color-sobre-primario', 'color-error', 4.5],
  ['texto del enlace «Eliminar mi cuenta» (error) sobre fondo', 'color-error', 'color-fondo', 4.5],
  ['borde de campos y casilla sobre fondo', 'color-borde', 'color-fondo', 3],
  ['borde de avisos sobre superficie', 'color-borde', 'color-superficie', 3],
  ['borde e icono de error sobre fondo', 'color-error', 'color-fondo', 3],
  ['icono de error sobre superficie', 'color-error', 'color-superficie', 3],
  ['borde e icono de éxito sobre fondo', 'color-exito', 'color-fondo', 3],
  ['icono de éxito sobre superficie', 'color-exito', 'color-superficie', 3],
  ['anillo de foco sobre fondo', 'color-foco', 'color-fondo', 3],
  ['anillo de foco sobre superficie', 'color-foco', 'color-superficie', 3],
];

describe('contrastes de los tokens (criterio 42)', () => {
  it('se han leído los tokens de color', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(12);
  });

  it.each(PAIRS)('%s ≥ mínimo', (_, foreground, background, minimum) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(minimum);
  });

  it('el anillo de foco mide 3 px con 2 px de margen (criterio 39)', () => {
    expect(css).toMatch(/--foco-anillo:\s*3px;/);
    expect(css).toMatch(/--foco-margen:\s*2px;/);
    expect(css).toMatch(
      /:focus-visible\s*{\s*outline:\s*var\(--foco-anillo\) solid var\(--color-foco\);/,
    );
  });
});

describe('todo sale de los tokens (criterio 54)', () => {
  const hardcoded = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

  it('app.css solo define colores dentro de :root', () => {
    const outsideRoot = css.replace(/:root\s*{[^}]*}/, '');
    expect(outsideRoot.match(hardcoded)).toBeNull();
  });

  it('ningún componente ni página lleva colores ni estilos en línea', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.svelte')) files.push(path);
      }
    };
    walk(SRC);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.match(hardcoded), `${file} tiene un color a mano`).toBeNull();
      expect(source, `${file} tiene un atributo style`).not.toMatch(/\sstyle=/);
      expect(source, `${file} tiene un bloque <style>`).not.toMatch(/<style[\s>]/);
    }
  });
});
