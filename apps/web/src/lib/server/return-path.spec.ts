import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path.ts';

describe('W-3: safeReturnPath', () => {
  it.each(['/cuenta', '/cuenta/eliminar'])('devuelve %s tal cual', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each(['https://otro.sitio', '//otro.sitio', '/otra', '', '/cuenta/', '/cuenta?x=1', null])(
    'con «%s» devuelve /cuenta',
    (value) => {
      expect(safeReturnPath(value)).toBe('/cuenta');
    },
  );
});
