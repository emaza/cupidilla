import { Module } from '@nestjs/common';
import { CaptchaReplayStore } from './captcha-replay.store.js';
import { CaptchaController } from './captcha.controller.js';
import { CaptchaService } from './captcha.service.js';

/**
 * Comprobación antibots con ALTCHA (técnico de captcha §3). No importa ningún otro módulo;
 * `AppModule` registra `CaptchaGuard` como guard global. Los módulos con rutas protegidas no lo
 * importan: `@RequiresCaptcha()` solo escribe metadatos.
 */
@Module({
  controllers: [CaptchaController],
  providers: [CaptchaService, CaptchaReplayStore],
  exports: [CaptchaService, CaptchaReplayStore],
})
export class CaptchaModule {}
