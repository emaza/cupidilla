import { checkBirthDate, referenceToday } from '@cupidilla/contracts';
import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import {
  dataReviewErrorsFromIssues,
  parseDataReviewForm,
  type DataReviewErrors,
} from '#lib/forms/data-review.ts';
import { firstApiIssueByField } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import { displayMailConfig, currentMinAge } from '#lib/server/min-age.ts';
import { urlMessage, withPasswordChangedNotice } from '#lib/server/oauth-notices.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * /account/review (correo UX §3.10, técnico §5.11). La fecha sale vacía: la web no pide la
 * guardada a la API ni la pinta, porque pudo escribirla otra persona.
 */
export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'Cache-Control': 'no-store' });
  const user = event.locals.user;
  if (!user) {
    // Tras la acción de un menor la cuenta ya no existe: la página pinta la pantalla de cierre.
    if (event.request.method === 'POST') return { message: null };
    // La API no ha respondido al comprobar la sesión (`sessionUnavailable`).
    error(503, 'API unavailable');
  }
  if (!user.dataReviewRequired) redirect(303, '/account');
  const mail = await displayMailConfig(event);
  const params = event.url.searchParams;
  return {
    message: withPasswordChangedNotice(
      urlMessage('review', params),
      params,
      mail.passwordChangedNotice,
    ),
  };
};

const onlyGeneral = (general: DataReviewErrors['general']): DataReviewErrors => ({
  fields: {},
  dateParts: [],
  general,
});

export const actions = {
  review: async (event) => {
    const { locals, cookies } = event;
    const token = locals.sessionToken;
    if (!token || !locals.user) redirect(303, '/login?next=/account');
    // Ya revisada (otra pestaña): nada que hacer aquí.
    if (!locals.user.dataReviewRequired) redirect(303, '/account');

    const data = await event.request.formData();
    const today = referenceToday(new Date());
    const parsed = parseDataReviewForm(data, today);
    if (parsed.kind === 'invalid') {
      return fail(400, { values: parsed.values, errors: parsed.errors });
    }

    const result = await api.completeDataReview(event, token, parsed.request);
    if (result.ok) redirect(303, '/account?notice=details-reviewed');

    const { code, fields } = result.error;
    if (code === 'UNDERAGE') {
      // La API ha borrado la cuenta: la sesión ya no existe. Pantalla de cierre sin valores (A3).
      clearSessionCookie(cookies);
      locals.user = null;
      locals.sessionToken = null;
      return fail(422, { underage: true as const });
    }
    // Quién es menor lo decide la API. Con un 400 o un 409 ya ha visto un adulto: los valores
    // vuelven. Si ha fallado sin decidir, la caché de la web solo sirve para no devolver la fecha
    // de quien parece menor (acuerdo A3); sin la edad mínima, tampoco.
    const adultConfirmed = code === 'VALIDATION_FAILED' || code === 'TERMS_VERSION_OUTDATED';
    const minAge = adultConfirmed ? null : await currentMinAge(event);
    const looksMinor =
      !adultConfirmed &&
      (minAge === null || !checkBirthDate(parsed.request.birthDate, today, minAge).ok);
    const values = looksMinor ? undefined : parsed.values;
    switch (code) {
      case 'UNAUTHENTICATED':
        clearSessionCookie(cookies);
        redirect(303, '/login?next=/account');
        break;
      case 'NOT_FOUND':
        // Ya no había revisión pendiente.
        redirect(303, '/account');
        break;
      case 'TERMS_VERSION_OUTDATED': {
        // La casilla vuelve desmarcada para que se lean y acepten las condiciones vigentes.
        const errors: DataReviewErrors = {
          fields: { acceptTerms: 'registro.error.condiciones_version' },
          dateParts: [],
        };
        return fail(409, { values: values && { ...values, acceptTerms: false }, errors });
      }
      case 'VALIDATION_FAILED': {
        const errors = dataReviewErrorsFromIssues(firstApiIssueByField(fields));
        if (Object.keys(errors.fields).length > 0) return fail(400, { values, errors });
        break;
      }
    }
    return fail(result.status, { values, errors: onlyGeneral(errorMessages.review[code]) });
  },

  /** «Cerrar sesión», en su propio formulario: se pedirá la revisión otra vez al entrar. */
  logout: async (event) => {
    const token = event.locals.sessionToken;
    const result = token ? await api.logout(event, token) : null;
    if (!result || result.ok || result.status === 401) {
      clearSessionCookie(event.cookies);
      event.locals.user = null;
      event.locals.sessionToken = null;
      redirect(303, '/?notice=signed-out');
    }
    return fail(503, { errors: onlyGeneral(errorMessages.logout[result.error.code]) });
  },
} satisfies Actions;
