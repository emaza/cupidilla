import { expect, test } from '@playwright/test';

test('E-7: un envío de formulario desde otro origen se rechaza con 403', async ({ request }) => {
  const response = await request.post('/entrar', {
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: 'correo=persona%40example.com&contrasena=una+frase+larga',
  });
  expect(response.status()).toBe(403);
});
