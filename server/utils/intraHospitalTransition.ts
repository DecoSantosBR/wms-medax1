/**
 * Helper: Transição de Status Pós-Expedição para Fluxo Intra-Hospitalar
 *
 * Encapsula a lógica de verificar se um tenant tem o módulo intra-hospitalar
 * ativo e transitar os pedidos expedidos para WAITING_INTERNAL_DOCK.
 *
 * Uso: chamado dentro de finalizeManifest após a expedição ser concluída.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { tenants, pickingOrders } from "../../drizzle/schema.js";

type DbClient = Awaited<ReturnType<typeof import("../db.js").getDb>>;

/**
 * Agrupa os orderIds por tenantId para verificar a flag hasIntraHospitalar
 * de cada tenant individualmente.
 *
 * Para cada tenant com hasIntraHospitalar === true, transita os pedidos
 * de status "shipped" para "waiting_internal_dock".
 *
 * @returns Mapa de tenantId → lista de orderIds transitados
 */
export async function applyIntraHospitalTransition(
  db: NonNullable<DbClient>,
  orderIds: number[]
): Promise<{ transitioned: number[]; skipped: number[] }> {
  if (orderIds.length === 0) return { transitioned: [], skipped: [] };

  // Buscar todos os pedidos para obter seus tenantIds
  const orders = await db
    .select({ id: pickingOrders.id, tenantId: pickingOrders.tenantId })
    .from(pickingOrders)
    .where(inArray(pickingOrders.id, orderIds));

  // Agrupar por tenantId
  const byTenant = new Map<number, number[]>();
  for (const order of orders) {
    if (!byTenant.has(order.tenantId)) byTenant.set(order.tenantId, []);
    byTenant.get(order.tenantId)!.push(order.id);
  }

  const transitioned: number[] = [];
  const skipped: number[] = [];

  for (const [tenantId, tenantOrderIds] of Array.from(byTenant)) {
    // Verificar se o tenant tem o módulo intra-hospitalar ativo
    const [tenant] = await db
      .select({ hasIntraHospitalar: tenants.hasIntraHospitalar })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      skipped.push(...tenantOrderIds);
      continue;
    }

    if (tenant.hasIntraHospitalar) {
      // Transitar pedidos para WAITING_INTERNAL_DOCK
      await db
        .update(pickingOrders)
        .set({ status: "waiting_internal_dock" })
        .where(
          sql`${pickingOrders.id} IN (${sql.join(tenantOrderIds.map(id => sql`${id}`), sql`, `)})`
        );
      transitioned.push(...tenantOrderIds);
      console.log(
        `[INTRA-HOSPITALAR] Tenant ${tenantId}: ${tenantOrderIds.length} pedido(s) transitados para WAITING_INTERNAL_DOCK`
      );
    } else {
      skipped.push(...tenantOrderIds);
    }
  }

  return { transitioned, skipped };
}
