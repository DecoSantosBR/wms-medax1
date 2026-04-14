/**
 * Admin Router — Operações administrativas restritas ao Global Admin
 * Inclui limpeza de dados de teste, reindexação e exportação de auditoria.
 */
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

/** Verifica se o usuário é Global Admin */
function assertGlobalAdmin(ctx: { user: { role: string; tenantId: number | null } }) {
  if (ctx.user.role !== "admin" || (ctx.user.tenantId !== 1 && ctx.user.tenantId !== null)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o Global Admin pode executar esta operação." });
  }
}

/** Executa um DELETE e retorna o número de linhas afetadas */
async function execDelete(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, rawSql: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(rawSql));
    // MySQL driver retorna affectedRows no ResultSetHeader
    const header = result as unknown as { affectedRows?: number };
    return header.affectedRows ?? 0;
  } catch {
    return 0;
  }
}

/** Monta cláusula WHERE para filtro de tenant */
function tenantWhere(tenantId?: number): string {
  return tenantId ? `WHERE tenantId = ${tenantId}` : "";
}

/** Monta cláusula WHERE IN baseada em subquery de tenant */
function tenantSubWhere(col: string, parentTable: string, parentCol: string, tenantId?: number): string {
  if (!tenantId) return "";
  return `WHERE ${col} IN (SELECT id FROM ${parentTable} WHERE tenantId = ${tenantId})`;
}

export const adminRouter = router({

  /**
   * Retorna um resumo do que será deletado antes de confirmar a limpeza.
   */
  cleanupPreview: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      scopes: z.array(z.enum([
        "receiving",
        "picking",
        "shipping",
        "inventory",
        "intraHospital",
      ])).min(1, "Selecione ao menos um escopo"),
    }))
    .query(async ({ input, ctx }) => {
      assertGlobalAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const tid = input.tenantId;
      const tw = (table: string) => tid ? `WHERE ${table}.tenantId = ${tid}` : "";
      const counts: Record<string, number> = {};

      const count = async (table: string, where = "") => {
        // db.execute retorna [[rows], [fields]] — precisa de desestruturação dupla
        const [[r]] = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ${table} ${where}`)) as unknown as [[{ cnt: string | number }]];
        return Number(r?.cnt ?? 0);
      };

      if (input.scopes.includes("receiving")) {
        counts.receivingOrders = await count("receivingOrders", tw("receivingOrders"));
        counts.receivingOrderItems = await count("receivingOrderItems", tw("receivingOrderItems"));
        counts.blindConferenceSessions = await count("blindConferenceSessions", tw("blindConferenceSessions"));
        counts.labelPrintHistory = await count("labelPrintHistory", tw("labelPrintHistory"));
      }

      if (input.scopes.includes("picking")) {
        counts.pickingOrders = await count("pickingOrders", tw("pickingOrders"));
        counts.pickingWaves = await count("pickingWaves", tw("pickingWaves"));
        counts.stageChecks = await count("stageChecks", tw("stageChecks"));
      }

      if (input.scopes.includes("shipping")) {
        counts.shipments = await count("shipments", tw("shipments"));
        counts.shipmentManifests = await count("shipmentManifests", tw("shipmentManifests"));
      }

      if (input.scopes.includes("inventory")) {
        counts.inventory = await count("inventory", tw("inventory"));
        counts.inventoryMovements = await count("inventoryMovements", tw("inventoryMovements"));
      }

      if (input.scopes.includes("intraHospital")) {
        counts.deliveryLogs = await count("deliveryLogs", tw("deliveryLogs"));
      }

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return { counts, total, tenantId: input.tenantId ?? null };
    }),

  /**
   * Executa a limpeza de dados de teste para os escopos selecionados.
   * Requer confirmação explícita via campo `confirmText = "CONFIRMAR"`.
   */
  cleanupTestData: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      scopes: z.array(z.enum([
        "receiving",
        "picking",
        "shipping",
        "inventory",
        "intraHospital",
      ])).min(1),
      confirmText: z.string().refine(v => v === "CONFIRMAR", {
        message: 'Digite exatamente "CONFIRMAR" para prosseguir.',
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      assertGlobalAdmin(ctx);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const tid = input.tenantId;
      const tw = (table: string) => tid ? `WHERE ${table}.tenantId = ${tid}` : "";
      const twPlain = tid ? `WHERE tenantId = ${tid}` : "";

      // Subquery WHERE para tabelas sem tenantId direto
      const subWhere = (col: string, parentTable: string) =>
        tid ? `WHERE ${col} IN (SELECT id FROM ${parentTable} WHERE tenantId = ${tid})` : "";

      const deletedCounts: Record<string, number> = {};
      const del = async (table: string, where = "") => {
        deletedCounts[table] = (deletedCounts[table] ?? 0) + await execDelete(db, `DELETE FROM ${table} ${where}`);
      };

      // ── Intra-Hospitalar ──────────────────────────────────────────────────
      if (input.scopes.includes("intraHospital")) {
        await del("deliveryLogs", twPlain);
      }

      // ── Expedição ─────────────────────────────────────────────────────────
      if (input.scopes.includes("shipping")) {
        await del("shipmentManifestItems", subWhere("manifestId", "shipmentManifests"));
        await del("shipmentManifests", twPlain);
        await del("shipments", twPlain);
      }

      // ── Separação (Picking) ───────────────────────────────────────────────
      if (input.scopes.includes("picking")) {
        await del("pickingWaveItems", subWhere("waveId", "pickingWaves"));
        await del("pickingAllocations", subWhere("pickingOrderId", "pickingOrders"));
        await del("pickingProgress", subWhere("pickingOrderId", "pickingOrders"));
        await del("pickingAuditLogs", subWhere("pickingOrderId", "pickingOrders"));
        await del("stageCheckItems", subWhere("stageCheckId", "stageChecks"));
        await del("stageChecks", twPlain);
        await del("pickingWaves", twPlain);
        await del("pickingOrderItems", subWhere("pickingOrderId", "pickingOrders"));
        await del("pickingOrders", twPlain);
      }

      // ── Recebimento ───────────────────────────────────────────────────────
      if (input.scopes.includes("receiving")) {
        await del("blindConferenceItems", subWhere("sessionId", "blindConferenceSessions"));
        await del("blindConferenceAdjustments", subWhere("sessionId", "blindConferenceSessions"));
        await del("labelAssociations", subWhere("receivingOrderId", "receivingOrders"));
        await del("labelReadings", twPlain);
        await del("labelPrintHistory", twPlain);
        await del("divergenceApprovals", subWhere("divergenceId", "receivingDivergences"));
        await del("nonConformities", twPlain);
        await del("receivingDivergences", twPlain);
        await del("receivingConferences", subWhere("receivingOrderId", "receivingOrders"));
        await del("receivingInvoiceItems", subWhere("receivingOrderId", "receivingOrders"));
        await del("blindConferenceSessions", twPlain);
        await del("receivingPreallocations", twPlain);
        await del("receivingOrderItems", twPlain);
        await del("receivingOrders", twPlain);
      }

      // ── Estoque ───────────────────────────────────────────────────────────
      if (input.scopes.includes("inventory")) {
        await del("inventoryCountItems", subWhere("countId", "inventoryCounts"));
        await del("inventoryCounts", twPlain);
        await del("inventoryMovements", twPlain);
        await del("inventory", twPlain);
      }

      const total = Object.values(deletedCounts).reduce((a, b) => a + b, 0);
      return {
        success: true,
        deletedCounts,
        total,
        message: `Limpeza concluída. ${total} registros removidos.`,
      };
    }),
});
