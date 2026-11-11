import argon2 from 'argon2';
import { beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD_HASH_OPTIONS, PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('genera hashes argon2id con los parámetros fijados', async () => {
    const hash = await service.hash('contraseña-larga');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    expect(service.needsRehash(hash)).toBe(false);
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await service.hash('contraseña-larga');
    expect(await service.verify(hash, 'contraseña-larga')).toBe(true);
    expect(await service.verify(hash, 'contraseña-larg')).toBe(false);
    expect(await service.verify('no-es-un-hash', 'contraseña-larga')).toBe(false);
  });

  it('normaliza a NFKC antes del hash y de la verificación', async () => {
    const hash = await service.hash('ﬁchero-seguro'); // ligadura «ﬁ»
    expect(await service.verify(hash, 'fichero-seguro')).toBe(true);
    const composed = await service.hash('canción-larga');
    expect(await service.verify(composed, 'canción-larga')).toBe(true);
  });

  it('pide rehacer el hash si se calculó con parámetros más débiles', async () => {
    const weak = await argon2.hash('contraseña-larga', { ...PASSWORD_HASH_OPTIONS, timeCost: 2 });
    expect(service.needsRehash(weak)).toBe(true);
  });

  it('verifyDummy termina sin error', async () => {
    await expect(service.verifyDummy('lo-que-sea')).resolves.toBeUndefined();
  });
});
