import { assertMailpitUp } from './helpers/mailpit.ts';

/** Antes de los e2e (correo §11.2): Mailpit tiene que estar levantado. */
export default async function globalSetup(): Promise<void> {
  await assertMailpitUp();
}
