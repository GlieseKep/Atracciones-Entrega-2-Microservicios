import { RouterProvider } from 'react-router-dom';
import { router } from './router';

/**
 * Proveedores globales. El estado vive en stores de Zustand (auth, compra, UI),
 * así que solo hace falta el router.
 */
export function Providers() {
  return <RouterProvider router={router} />;
}
