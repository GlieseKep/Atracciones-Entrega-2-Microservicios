import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import { useAuthStore } from '@/stores/authStore';

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = `x.${b64({ sub: 'acc-1', email: 'ana@example.com', name: 'Ana', scope: 'attractions:read attractions:book' })}.sig`;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('páginas de acceso', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    useAuthStore.getState().clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('inicia sesión, guarda el token en memoria y vuelve a la ruta solicitada', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/login')) {
        return new Response(JSON.stringify({ access_token: jwt, token_type: 'Bearer', expires_in: 3600, scope: '', user: {} }), { status: 200 });
      }
      // Perfil del API ya existente.
      return new Response(JSON.stringify({ id: 'u1', email: 'ana@example.com', status: 'ACTIVE' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    renderAt(`/login?returnTo=${encodeURIComponent('/perfil')}`);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Tour2026!');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/perfil');
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: jwt, claims: { sub: 'acc-1', name: 'Ana' } });
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain(jwt);
  });

  it('muestra el error del servicio ante credenciales incorrectas', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS', detail: 'Correo o contraseña incorrectos.' }), { status: 401 }),
    );
    renderAt('/login');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('valida el registro antes de llamar al servicio', async () => {
    renderAt('/registro');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'corta');
    await userEvent.type(screen.getByLabelText('Repite la contraseña'), 'otra');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Mínimo 8 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('Debes aceptar los términos de uso.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige que las contraseñas coincidan', async () => {
    renderAt('/registro');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Tour2026!');
    await userEvent.type(screen.getByLabelText('Repite la contraseña'), 'Tour2027!');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
