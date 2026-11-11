import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/** Parámetros de argon2id escritos a propósito: no deben cambiar sin que se note (§8.1). */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

const normalize = (password: string): string => password.normalize('NFKC');

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  /** Hash ficticio para igualar el tiempo de respuesta cuando el correo no existe. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(
      randomBytes(32).toString('base64url'),
      PASSWORD_HASH_OPTIONS,
    );
  }

  hash(password: string): Promise<string> {
    return argon2.hash(normalize(password), PASSWORD_HASH_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, normalize(password));
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, PASSWORD_HASH_OPTIONS);
  }
}
