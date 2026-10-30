import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeTime } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { S } from './inventory-repository';

/** Parte del catálogo inicial v2 que le corresponde a Inventory (guías, tarifas y horarios). */
interface InventorySeed {
  guias: { codigo: string; titulo: string | null; nombre: string; credencial_mintur: string | null }[];
  atracciones: {
    codigo_publico: string;
    tarifa: { adulto: number; nino: number; tercera_edad: number; estudiante: number | null; infante: number };
    horarios: { hora: string; capacidad: number; guia: string | null }[];
  }[];
}

export const seedFile = () => process.env.SEED_CATALOG_FILE ?? resolve(__dirname, '..', '..', '..', 'seed', 'catalogo-v2.json');

/** Vigencia de la tarifa inicial (abierta hacia adelante). */
const TARIFA_DESDE = '2026-01-01';

/**
 * Carga guías, tarifas y horarios del catálogo inicial si todavía no existen (idempotente). Los turnos se generan
 * después a partir de los horarios (`InventoryRepository.generateSlots`).
 */
export async function seedInventory(dataSource: DataSource, file = seedFile()): Promise<number> {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as InventorySeed;
  return dataSource.transaction(async (m) => {
    for (const g of seed.guias) {
      await m.query(
        `INSERT INTO ${S}.guia (codigo, titulo, nombre, credencial_mintur) VALUES ($1, $2, $3, $4) ON CONFLICT (codigo) DO NOTHING`,
        [g.codigo, g.titulo, g.nombre, g.credencial_mintur],
      );
    }
    let created = 0;
    for (const a of seed.atracciones) {
      const [exists] = await m.query(`SELECT 1 FROM ${S}.tarifa WHERE atraccion_codigo = $1`, [a.codigo_publico]);
      if (exists) continue;
      const [tarifa] = await m.query(
        `INSERT INTO ${S}.tarifa (atraccion_codigo, moneda, vigente_desde) VALUES ($1, 'USD', $2) RETURNING id`,
        [a.codigo_publico, TARIFA_DESDE],
      );
      const precios: [string, number | null][] = [
        ['ADULT', a.tarifa.adulto], ['CHILD', a.tarifa.nino], ['SENIOR', a.tarifa.tercera_edad], ['STUDENT', a.tarifa.estudiante], ['INFANT', a.tarifa.infante],
      ];
      for (const [tipo, precio] of precios) {
        if (precio === null) continue;
        await m.query(`INSERT INTO ${S}.tarifa_precio (tarifa_id, tipo_boleto, precio) VALUES ($1, $2, $3)`, [tarifa.id, tipo, precio]);
      }
      for (const h of a.horarios) {
        for (let dia = 1; dia <= 7; dia++) {
          await m.query(
            `INSERT INTO ${S}.horario (atraccion_codigo, dia_semana, hora_inicio, capacidad, guia_id, vigente_desde)
             VALUES ($1, $2, $3, $4, (SELECT id FROM ${S}.guia WHERE codigo = $5), $6)`,
            [a.codigo_publico, dia, normalizeTime(h.hora), h.capacidad, h.guia, TARIFA_DESDE],
          );
        }
      }
      created++;
    }
    return created;
  });
}
