<script lang="ts">
  import type { DatePart } from '#lib/forms/birth-date.ts';
  import { fill, t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  /** Fecha de nacimiento en tres campos (H0 §3.2), común a /register y /register/complete. */
  interface Props {
    /** Edad mínima configurada, para la ayuda. */
    minAge: number;
    values?: { day?: string; month?: string; year?: string };
    error?: string;
    /** Partes que se marcan como erróneas. */
    invalidParts?: DatePart[];
  }

  let { minAge, values, error, invalidParts = [] }: Props = $props();

  const dateParts: {
    id: DatePart;
    label: string;
    maxlength: number;
    autocomplete: 'bday-day' | 'bday-month' | 'bday-year';
  }[] = [
    { id: 'day', label: t('registro.campo.dia'), maxlength: 2, autocomplete: 'bday-day' },
    { id: 'month', label: t('registro.campo.mes'), maxlength: 2, autocomplete: 'bday-month' },
    { id: 'year', label: t('registro.campo.anio'), maxlength: 4, autocomplete: 'bday-year' },
  ];
</script>

<fieldset
  class="birth-date"
  aria-describedby={error ? 'birth-date-help birth-date-error' : 'birth-date-help'}
>
  <legend>{t('registro.campo.nacimiento')}</legend>
  <p id="birth-date-help" class="help">
    {fill('registro.ayuda.nacimiento', { edad: String(minAge) })}
  </p>
  {#if error}
    <FieldError id="birth-date-error" text={error} />
  {/if}
  <div class="birth-date-parts">
    {#each dateParts as part (part.id)}
      {@const invalid = error !== undefined && invalidParts.includes(part.id)}
      <div class="date-part" class:date-part-year={part.id === 'year'}>
        <label for={part.id}>{part.label}</label>
        <input
          id={part.id}
          name={part.id}
          type="text"
          inputmode="numeric"
          maxlength={part.maxlength}
          autocomplete={part.autocomplete}
          defaultValue={values?.[part.id] ?? ''}
          aria-describedby={invalid ? 'birth-date-error' : undefined}
          aria-invalid={invalid ? 'true' : undefined}
        />
      </div>
    {/each}
  </div>
</fieldset>
