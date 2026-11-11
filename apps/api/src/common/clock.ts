import { Global, Injectable, Module } from '@nestjs/common';

/** Fuente única de «ahora». Los tests la sustituyen por un reloj fijo. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
