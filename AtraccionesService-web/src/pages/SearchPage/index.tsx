import { Navigate, useLocation } from 'react-router-dom';

/**
 * Viator usa una única página de resultados para búsqueda y exploración. La búsqueda avanzada,
 * los filtros persistentes (en la URL) y el estado sin resultados viven en AttractionsPage;
 * `/buscar` se conserva como alias para enlaces externos.
 */
export default function SearchPage() {
  const { search } = useLocation();
  return <Navigate to={`/atracciones${search}`} replace />;
}
