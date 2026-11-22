import { fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { firstApiIssueByField } from '#lib/forms/form-data.ts';
import { contactErrorsFromIssues, parseContactForm } from '#lib/forms/contact.ts';
import { setContactSent } from '#lib/server/contact-cookie.ts';
import { displayContactConfig } from '#lib/server/min-age.ts';
import { api } from '#lib/server/api-client.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * /contact (contacto UX §2.1, técnico §8.1). Pública, con o sin sesión. Con sesión, el correo
 * viene relleno y se puede cambiar; el mensaje no se enlaza con la cuenta.
 */
export const load: PageServerLoad = ({ locals }) => ({ email: locals.user?.email ?? '' });

export const actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const parsed = parseContactForm(data);
    if (parsed.kind === 'invalid') {
      return fail(400, { values: parsed.values, errors: parsed.errors });
    }

    const result = await api.sendContactMessage(event, parsed.request);
    if (result.ok) {
      // Ante el campo trampa no se promete el acuse: la API no ha guardado nada (UX §2.1.3).
      const ack = !parsed.honeypot && (await displayContactConfig(event)).ackEmail;
      setContactSent(event.cookies, { email: parsed.request.email, ack });
      redirect(303, '/contact/sent');
    }

    const { code, fields } = result.error;
    if (code === 'PRIVACY_VERSION_OUTDATED') {
      // En la casilla, que vuelve desmarcada: hay que leer el texto nuevo (técnico C10).
      const errors = contactErrorsFromIssues(new Map());
      errors.fields.acceptPrivacy = errorMessages.contact[code];
      return fail(result.status, { values: { ...parsed.values, acceptPrivacy: false }, errors });
    }
    if (code === 'VALIDATION_FAILED' && fields?.length) {
      const errors = contactErrorsFromIssues(firstApiIssueByField(fields));
      if (Object.keys(errors.fields).length > 0) {
        return fail(result.status, { values: parsed.values, errors });
      }
    }
    return fail(result.status, {
      values: parsed.values,
      errors: { fields: {}, general: errorMessages.contact[code] },
    });
  },
} satisfies Actions;
