import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path.ts';

describe('W-3: safeReturnPath', () => {
  it.each(['/account', '/account/delete'])('devuelve %s tal cual', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each(['https://otro.sitio', '//otro.sitio', '/otra', '', '/account/', '/account?x=1', null])(
    'con «%s» devuelve /account',
    (value) => {
      expect(safeReturnPath(value)).toBe('/account');
    },
  );
});
