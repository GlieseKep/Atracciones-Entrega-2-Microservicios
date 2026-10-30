import { INCLUSION_TYPES, OPERATOR_CHARGES, type InclusionType, type OperatorCharge } from '../contract';
import type { CategoryCreate, CategoryPatch } from '../persistence/category-repository';
import type { GuidePatch } from '../persistence/guide-repository';
import type { OperatorCreate, OperatorPatch } from '../persistence/operator-repository';
import { Fields } from './fields';

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const RUC = /^[0-9]{13}$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseGuide(body: unknown): { codigo: string; nombre: string; credencial: string; operador: string; usuId: number | null } {
  const f = new Fields(body);
  const input = {
    codigo: f.text('codigo', 30),
    nombre: f.text('nombre', 150),
    credencial: f.text('credencial_mintur', 30),
    operador: f.text('operador', 60),
    usuId: f.optionalInteger('usu_id', { min: 1 }),
  };
  f.done();
  return input;
}

export function parseGuidePatch(body: unknown): GuidePatch {
  const f = new Fields(body);
  const patch: GuidePatch = {};
  if (f.has('nombre')) patch.gui_nombre = f.text('nombre', 150);
  if (f.has('credencial_mintur')) patch.gui_credencial_mintur = f.text('credencial_mintur', 30);
  if (f.has('usu_id')) patch.usu_id = f.optionalInteger('usu_id', { min: 1 });
  if (f.has('activo')) patch.gui_activo = f.bool('activo');
  f.done();
  return patch;
}

export function parseOperator(body: unknown): OperatorCreate {
  const f = new Fields(body);
  const input: OperatorCreate = {
    codigo: f.text('id', 60),
    nombre: f.text('nombre_comercial', 150),
    ruc: f.optionalText('ruc', 13, RUC),
    correo: f.optionalText('email_soporte', 160, EMAIL),
    telefono: f.optionalText('telefono_emergencia', 20, PHONE),
    direccion: f.optionalText('direccion', 255),
    provId: f.integer('prov_id', { min: 1, max: 32767 }),
  };
  f.done();
  return input;
}

export function parseOperatorPatch(body: unknown): OperatorPatch {
  const f = new Fields(body);
  const patch: OperatorPatch = {};
  if (f.has('nombre_comercial')) patch.ope_nombre = f.text('nombre_comercial', 150);
  if (f.has('ruc')) patch.ope_ruc = f.optionalText('ruc', 13, RUC);
  if (f.has('email_soporte')) patch.ope_correo = f.optionalText('email_soporte', 160, EMAIL);
  if (f.has('telefono_emergencia')) patch.ope_telefono = f.optionalText('telefono_emergencia', 20, PHONE);
  if (f.has('direccion')) patch.ope_direccion = f.optionalText('direccion', 255);
  if (f.has('prov_id')) patch.prov_id = f.integer('prov_id', { min: 1, max: 32767 });
  if (f.has('activo')) patch.ope_activo = f.bool('activo');
  f.done();
  return patch;
}

export function parseOperatorUser(body: unknown): { usuId: number; cargo: OperatorCharge } {
  const f = new Fields(body);
  const input = { usuId: f.integer('usu_id', { min: 1 }), cargo: f.oneOf('cargo', OPERATOR_CHARGES) };
  f.done();
  return input;
}

export function parseCategory(body: unknown): CategoryCreate {
  const f = new Fields(body);
  const input: CategoryCreate = {
    codigo: f.text('id', 40),
    padre: f.optionalText('padre_id', 40),
    nombre: f.text('nombre', 80),
    slug: f.text('slug', 80),
    descripcion: f.optionalText('descripcion', 255),
    icono: f.optionalText('icono', 40),
    orden: f.integer('orden', { min: -32768, max: 32767 }, 0),
    incluyeComida: f.bool('incluye_comida'),
    incluyeTransporte: f.bool('incluye_transporte'),
    incluyeGuia: f.bool('incluye_guia'),
  };
  if (input.slug && !SLUG.test(input.slug)) f.fail('slug', 'El formato no es válido.');
  f.done();
  return input;
}

export function parseCategoryPatch(body: unknown): CategoryPatch {
  const f = new Fields(body);
  const patch: CategoryPatch = {};
  if (f.has('nombre')) patch.cat_nombre = f.text('nombre', 80);
  if (f.has('descripcion')) patch.cat_descripcion = f.optionalText('descripcion', 255);
  if (f.has('icono')) patch.cat_icono = f.text('icono', 40);
  if (f.has('orden')) patch.cat_orden = f.integer('orden', { min: -32768, max: 32767 });
  if (f.has('incluye_comida')) patch.cat_incluye_comida = f.bool('incluye_comida');
  if (f.has('incluye_transporte')) patch.cat_incluye_transporte = f.bool('incluye_transporte');
  if (f.has('incluye_guia')) patch.cat_incluye_guia = f.bool('incluye_guia');
  if (f.has('activa')) patch.cat_activa = f.bool('activa');
  f.done();
  return patch;
}

export function parseInclusion(body: unknown): { tipo: InclusionType; nombre: string; orden: number } {
  const f = new Fields(body);
  const input = { tipo: f.oneOf('tipo', INCLUSION_TYPES), nombre: f.text('nombre', 150), orden: f.integer('orden', { min: -32768, max: 32767 }, 0) };
  f.done();
  return input;
}
