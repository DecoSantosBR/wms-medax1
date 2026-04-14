/**
 * Router Intra-Hospitalar (Last Mile Interna)
 * Gerencia pontos de entrega e checkpoints de rastreabilidade dentro do hospital.
 */
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import {
  deliveryPoints,
  deliveryLogs,
  pickingOrders,
  systemUsers,
  tenants,
} from "../drizzle/schema";
import { eq, and, desc, inArray, sql, gte, lte } from "drizzle-orm";

// ─── Schemas de Validação ────────────────────────────────────────────────────

const deliveryPointSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(255),
  type: z.enum(["DOCK", "PHARMACY"]),
  externalCode: z.string().min(1, "Código externo é obrigatório").max(100),
  description: z.string().optional(),
  active: z.boolean().optional().default(true),
});

// Ordem lógica de transição de status
const STATUS_ORDER: Record<string, number> = {
  ARRIVED_COMPLEX: 1,
  DEPARTED_TO_UNIT: 2,
  ARRIVED_UNIT: 3,
  RECEIVE_COMPLETE: 4,
};

/**
 * Valida se a transição de status é permitida para um pedido.
 * Regras:
 *   - ARRIVED_UNIT requer ARRIVED_COMPLEX anterior
 *   - RECEIVE_COMPLETE requer ARRIVED_UNIT anterior
 *   - DEPARTED_TO_UNIT requer ARRIVED_COMPLEX anterior
 */
function validateStatusTransition(
  existingStatuses: string[],
  newStatus: string
): { valid: boolean; message?: string } {
        const hasStatus = (s: string) => (existingStatuses as string[]).includes(s);

  if (newStatus === "DEPARTED_TO_UNIT" && !hasStatus("ARRIVED_COMPLEX")) {
    return {
      valid: false,
      message: "O pedido deve chegar à doca (ARRIVED_COMPLEX) antes de sair para a unidade.",
    };
  }
  if (newStatus === "ARRIVED_UNIT" && !hasStatus("ARRIVED_COMPLEX")) {
    return {
      valid: false,
      message: "O pedido deve chegar ao complexo (ARRIVED_COMPLEX) antes de chegar à farmácia.",
    };
  }
  if (newStatus === "RECEIVE_COMPLETE" && !hasStatus("ARRIVED_UNIT")) {
    return {
      valid: false,
      message: "O pedido deve chegar à farmácia (ARRIVED_UNIT) antes de finalizar o recebimento.",
    };
  }
  return { valid: true };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const intraHospitalRouter = router({

  // ── Pontos de Entrega ──────────────────────────────────────────────────────

  /** Lista todos os pontos de entrega do tenant */
  listDeliveryPoints: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      type: z.enum(["DOCK", "PHARMACY"]).optional(),
      activeOnly: z.boolean().optional().default(true),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      const conditions = [eq(deliveryPoints.tenantId, activeTenantId)];
      if (input.type) conditions.push(eq(deliveryPoints.type, input.type));
      if (input.activeOnly) conditions.push(eq(deliveryPoints.active, true));

      const rows = await db
        .select({
          id: deliveryPoints.id,
          tenantId: deliveryPoints.tenantId,
          name: deliveryPoints.name,
          type: deliveryPoints.type,
          externalCode: deliveryPoints.externalCode,
          description: deliveryPoints.description,
          active: deliveryPoints.active,
          createdAt: deliveryPoints.createdAt,
          tenantName: tenants.name,
        })
        .from(deliveryPoints)
        .leftJoin(tenants, eq(deliveryPoints.tenantId, tenants.id))
        .where(and(...conditions))
        .orderBy(deliveryPoints.type, deliveryPoints.name);

      return rows;
    }),

  /** Busca ponto de entrega por externalCode (para scan de QR Code) */
  getDeliveryPointByCode: protectedProcedure
    .input(z.object({
      externalCode: z.string(),
      tenantId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      const [point] = await db.select()
        .from(deliveryPoints)
        .where(and(
          eq(deliveryPoints.externalCode, input.externalCode),
          eq(deliveryPoints.tenantId, activeTenantId),
          eq(deliveryPoints.active, true),
        ))
        .limit(1);

      if (!point) throw new TRPCError({ code: "NOT_FOUND", message: `Ponto de entrega não encontrado para o código: ${input.externalCode}` });
      return point;
    }),

  /** Cria novo ponto de entrega */
  createDeliveryPoint: protectedProcedure
    .input(deliveryPointSchema.extend({ tenantId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Verificar duplicidade de externalCode no tenant
      const [existing] = await db.select({ id: deliveryPoints.id })
        .from(deliveryPoints)
        .where(and(
          eq(deliveryPoints.tenantId, activeTenantId),
          eq(deliveryPoints.externalCode, input.externalCode),
        ))
        .limit(1);

      if (existing) throw new TRPCError({ code: "CONFLICT", message: `Já existe um ponto de entrega com o código "${input.externalCode}"` });

      await db.insert(deliveryPoints).values({
        tenantId: activeTenantId,
        name: input.name,
        type: input.type,
        externalCode: input.externalCode,
        description: input.description,
        active: input.active ?? true,
      });

      const [created] = await db.select()
        .from(deliveryPoints)
        .where(and(
          eq(deliveryPoints.tenantId, activeTenantId),
          eq(deliveryPoints.externalCode, input.externalCode),
        ))
        .limit(1);

      return { success: true, deliveryPoint: created };
    }),

  /** Atualiza ponto de entrega */
  updateDeliveryPoint: protectedProcedure
    .input(deliveryPointSchema.partial().extend({
      id: z.number(),
      tenantId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      const [point] = await db.select()
        .from(deliveryPoints)
        .where(and(eq(deliveryPoints.id, input.id), eq(deliveryPoints.tenantId, activeTenantId)))
        .limit(1);

      if (!point) throw new TRPCError({ code: "NOT_FOUND", message: "Ponto de entrega não encontrado" });

      const updateData: Partial<typeof deliveryPoints.$inferInsert> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.type !== undefined) updateData.type = input.type;
      if (input.externalCode !== undefined) updateData.externalCode = input.externalCode;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.active !== undefined) updateData.active = input.active;

      await db.update(deliveryPoints).set(updateData).where(eq(deliveryPoints.id, input.id));
      return { success: true };
    }),

  /** Remove (desativa) ponto de entrega */
  deleteDeliveryPoint: protectedProcedure
    .input(z.object({ id: z.number(), tenantId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      const [point] = await db.select()
        .from(deliveryPoints)
        .where(and(eq(deliveryPoints.id, input.id), eq(deliveryPoints.tenantId, activeTenantId)))
        .limit(1);

      if (!point) throw new TRPCError({ code: "NOT_FOUND", message: "Ponto de entrega não encontrado" });

      // Soft delete: desativar em vez de excluir
      await db.update(deliveryPoints)
        .set({ active: false })
        .where(eq(deliveryPoints.id, input.id));

      return { success: true };
    }),

  // ── Checkpoints / Logs ─────────────────────────────────────────────────────

  /**
   * Registra um checkpoint para um único pedido.
   * Valida a transição de status antes de persistir.
   */
  scanCheckpoint: protectedProcedure
    .input(z.object({
      orderId: z.number(),
      deliveryPointId: z.number(),
      status: z.enum(["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT", "ARRIVED_UNIT", "RECEIVE_COMPLETE"]),
      notes: z.string().optional(),
      tenantId: z.number().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Verificar se o ponto de entrega pertence ao tenant
      const [point] = await db.select()
        .from(deliveryPoints)
        .where(and(
          eq(deliveryPoints.id, input.deliveryPointId),
          eq(deliveryPoints.tenantId, activeTenantId),
          eq(deliveryPoints.active, true),
        ))
        .limit(1);

      if (!point) throw new TRPCError({ code: "NOT_FOUND", message: "Ponto de entrega não encontrado ou inativo" });

      // Verificar se o pedido existe e pertence ao tenant
      const [order] = await db.select({ id: pickingOrders.id, customerOrderNumber: pickingOrders.customerOrderNumber })
        .from(pickingOrders)
        .where(and(
          eq(pickingOrders.id, input.orderId),
          eq(pickingOrders.tenantId, activeTenantId),
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: `Pedido #${input.orderId} não encontrado` });

      // Buscar checkpoints existentes do pedido
      const existingLogs = await db.select({ status: deliveryLogs.status })
        .from(deliveryLogs)
        .where(and(
          eq(deliveryLogs.orderId, input.orderId),
          eq(deliveryLogs.tenantId, activeTenantId),
        ));

      const existingStatuses = existingLogs.map(l => l.status);

      // Validar transição de status
      const validation = validateStatusTransition(existingStatuses, input.status);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.message });
      }

      // Verificar coerência entre tipo de ponto e status
      if (input.status === "ARRIVED_COMPLEX" && point.type !== "DOCK") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ARRIVED_COMPLEX só pode ser registrado em pontos do tipo DOCK" });
      }
      if (input.status === "ARRIVED_UNIT" && point.type !== "PHARMACY") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ARRIVED_UNIT só pode ser registrado em pontos do tipo PHARMACY" });
      }
      if (input.status === "RECEIVE_COMPLETE" && point.type !== "PHARMACY") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RECEIVE_COMPLETE só pode ser registrado em pontos do tipo PHARMACY" });
      }

      // Registrar checkpoint
      await db.insert(deliveryLogs).values({
        tenantId: activeTenantId,
        orderId: input.orderId,
        deliveryPointId: input.deliveryPointId,
        status: input.status,
        notes: input.notes,
        userId: input.userId ?? null,
        timestamp: new Date(),
      });

      return {
        success: true,
        orderId: input.orderId,
        orderNumber: order.customerOrderNumber,
        status: input.status,
        pointName: point.name,
        warning: !existingStatuses.includes("ARRIVED_COMPLEX") && input.status === "ARRIVED_UNIT"
          ? "Atenção: pedido chegou à farmácia sem registro de chegada à doca."
          : undefined,
      };
    }),

  /**
   * Batch Scan: registra o mesmo checkpoint para múltiplos pedidos de uma vez.
   * Retorna resultado individual por pedido (sucesso/erro).
   */
  batchScanCheckpoint: protectedProcedure
    .input(z.object({
      orderIds: z.array(z.number()).min(1, "Selecione ao menos um pedido"),
      deliveryPointId: z.number(),
      status: z.enum(["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT", "ARRIVED_UNIT", "RECEIVE_COMPLETE"]),
      notes: z.string().optional(),
      tenantId: z.number().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Verificar ponto de entrega
      const [point] = await db.select()
        .from(deliveryPoints)
        .where(and(
          eq(deliveryPoints.id, input.deliveryPointId),
          eq(deliveryPoints.tenantId, activeTenantId),
          eq(deliveryPoints.active, true),
        ))
        .limit(1);

      if (!point) throw new TRPCError({ code: "NOT_FOUND", message: "Ponto de entrega não encontrado ou inativo" });

      // Verificar coerência tipo/status
      if (input.status === "ARRIVED_COMPLEX" && point.type !== "DOCK") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ARRIVED_COMPLEX só pode ser registrado em pontos do tipo DOCK" });
      }
      if ((input.status === "ARRIVED_UNIT" || input.status === "RECEIVE_COMPLETE") && point.type !== "PHARMACY") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${input.status} só pode ser registrado em pontos do tipo PHARMACY` });
      }

      // Buscar pedidos válidos do tenant
      const orders = await db.select({ id: pickingOrders.id, customerOrderNumber: pickingOrders.customerOrderNumber })
        .from(pickingOrders)
        .where(and(
          inArray(pickingOrders.id, input.orderIds),
          eq(pickingOrders.tenantId, activeTenantId),
        ));

      const validOrderIds = new Set(orders.map(o => o.id));
      const orderMap = new Map(orders.map(o => [o.id, o]));

      // Buscar logs existentes para todos os pedidos de uma vez
      const allExistingLogs = await db.select({ orderId: deliveryLogs.orderId, status: deliveryLogs.status })
        .from(deliveryLogs)
        .where(and(
          inArray(deliveryLogs.orderId, input.orderIds),
          eq(deliveryLogs.tenantId, activeTenantId),
        ));

      // Agrupar logs por pedido
      const logsByOrder = new Map<number, string[]>();
      for (const log of allExistingLogs) {
        if (!logsByOrder.has(log.orderId)) logsByOrder.set(log.orderId, []);
        logsByOrder.get(log.orderId)!.push(log.status as string);
      }

      const results: Array<{
        orderId: number;
        orderNumber: string | null;
        success: boolean;
        error?: string;
        warning?: string;
      }> = [];

      const logsToInsert: Array<typeof deliveryLogs.$inferInsert> = [];

      for (const orderId of input.orderIds) {
        if (!validOrderIds.has(orderId)) {
          results.push({ orderId, orderNumber: null, success: false, error: `Pedido #${orderId} não encontrado` });
          continue;
        }

        const existingStatuses = logsByOrder.get(orderId) ?? [];
        const validation = validateStatusTransition(existingStatuses, input.status);

        if (!validation.valid) {
          results.push({
            orderId,
            orderNumber: orderMap.get(orderId)?.customerOrderNumber ?? null,
            success: false,
            error: validation.message,
          });
          continue;
        }

        logsToInsert.push({
          tenantId: activeTenantId,
          orderId,
          deliveryPointId: input.deliveryPointId,
          status: input.status,
          notes: input.notes,
          userId: input.userId ?? null,
          timestamp: new Date(),
        });

        results.push({
          orderId,
          orderNumber: orderMap.get(orderId)?.customerOrderNumber ?? null,
          success: true,
          warning: !existingStatuses.includes("ARRIVED_COMPLEX") && input.status === "ARRIVED_UNIT"
            ? "Pedido chegou à farmácia sem registro de chegada à doca."
            : undefined,
        });
      }

      // Inserir todos os logs válidos de uma vez
      if (logsToInsert.length > 0) {
        await db.insert(deliveryLogs).values(logsToInsert);
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      return {
        success: errorCount === 0,
        successCount,
        errorCount,
        results,
        pointName: point.name,
        status: input.status,
      };
    }),

  // ── Timeline e Relatórios ──────────────────────────────────────────────────

  /**
   * Retorna a timeline completa de checkpoints de um pedido.
   */
  getOrderTimeline: protectedProcedure
    .input(z.object({
      orderId: z.number(),
      tenantId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Buscar logs com dados do ponto e do operador
      const logs = await db
        .select({
          id: deliveryLogs.id,
          status: deliveryLogs.status,
          timestamp: deliveryLogs.timestamp,
          notes: deliveryLogs.notes,
          pointId: deliveryPoints.id,
          pointName: deliveryPoints.name,
          pointType: deliveryPoints.type,
          userId: systemUsers.id,
          userName: systemUsers.fullName,
        })
        .from(deliveryLogs)
        .leftJoin(deliveryPoints, eq(deliveryLogs.deliveryPointId, deliveryPoints.id))
        .leftJoin(systemUsers, eq(deliveryLogs.userId, systemUsers.id))
        .where(and(
          eq(deliveryLogs.orderId, input.orderId),
          eq(deliveryLogs.tenantId, activeTenantId),
        ))
        .orderBy(deliveryLogs.timestamp);

      // Calcular lead times entre checkpoints
      const timelineWithLeadTime = logs.map((log, index) => {
        const prev = index > 0 ? logs[index - 1] : null;
        const leadTimeMinutes = prev
          ? Math.round((new Date(log.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 60000)
          : null;

        return {
          ...log,
          leadTimeMinutes,
          statusLabel: {
            ARRIVED_COMPLEX: "Chegada à Doca",
            DEPARTED_TO_UNIT: "Saída para Farmácia",
            ARRIVED_UNIT: "Chegada à Farmácia",
            RECEIVE_COMPLETE: "Recebimento Concluído",
          }[log.status] ?? log.status,
        };
      });

      // Calcular lead time total (primeiro ao último checkpoint)
      const totalLeadTimeMinutes = logs.length >= 2
        ? Math.round(
            (new Date(logs[logs.length - 1].timestamp).getTime() - new Date(logs[0].timestamp).getTime()) / 60000
          )
        : null;

      return {
        orderId: input.orderId,
        timeline: timelineWithLeadTime,
        totalLeadTimeMinutes,
        isComplete: logs.some(l => l.status === "RECEIVE_COMPLETE"),
        hasDockedArrival: logs.some(l => l.status === "ARRIVED_COMPLEX"),
        hasPharmacyArrival: logs.some(l => l.status === "ARRIVED_UNIT"),
      };
    }),

  /**
   * Relatório de SLA: tempo médio de trânsito interno por etapa.
   */
  getSlaReport: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(),
      deliveryPointId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Buscar todos os logs do período com dados do ponto
      const conditions = [eq(deliveryLogs.tenantId, activeTenantId)];
      if (input.startDate) conditions.push(gte(deliveryLogs.timestamp, new Date(input.startDate)));
      if (input.endDate) conditions.push(lte(deliveryLogs.timestamp, new Date(input.endDate)));
      if (input.deliveryPointId) conditions.push(eq(deliveryLogs.deliveryPointId, input.deliveryPointId));

      const allLogs = await db
        .select({
          orderId: deliveryLogs.orderId,
          status: deliveryLogs.status,
          timestamp: deliveryLogs.timestamp,
          pointName: deliveryPoints.name,
          pointType: deliveryPoints.type,
        })
        .from(deliveryLogs)
        .leftJoin(deliveryPoints, eq(deliveryLogs.deliveryPointId, deliveryPoints.id))
        .where(and(...conditions))
        .orderBy(deliveryLogs.orderId, deliveryLogs.timestamp);

      // Agrupar por pedido
      const byOrder = new Map<number, typeof allLogs>();
      for (const log of allLogs) {
        if (!byOrder.has(log.orderId)) byOrder.set(log.orderId, []);
        byOrder.get(log.orderId)!.push(log);
      }

      // Calcular lead times por etapa
      const stageTimes: Record<string, number[]> = {
        "Doca → Farmácia": [],
        "Farmácia → Recebimento": [],
        "Total (Doca → Recebimento)": [],
      };

      let completedOrders = 0;
      let pendingOrders = 0;

      for (const [, logs] of Array.from(byOrder)) {
        const getTime = (status: string) => {
          const log = logs.find(l => l.status === status);
          return log ? new Date(log.timestamp).getTime() : null;
        };

        const arrivedComplex = getTime("ARRIVED_COMPLEX");
        const arrivedUnit = getTime("ARRIVED_UNIT");
        const receiveComplete = getTime("RECEIVE_COMPLETE");

        if (arrivedComplex && arrivedUnit) {
          stageTimes["Doca → Farmácia"].push(Math.round((arrivedUnit - arrivedComplex) / 60000));
        }
        if (arrivedUnit && receiveComplete) {
          stageTimes["Farmácia → Recebimento"].push(Math.round((receiveComplete - arrivedUnit) / 60000));
        }
        if (arrivedComplex && receiveComplete) {
          stageTimes["Total (Doca → Recebimento)"].push(Math.round((receiveComplete - arrivedComplex) / 60000));
          completedOrders++;
        } else {
          pendingOrders++;
        }
      }

      const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : null;
      const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : null;

      const report = Object.entries(stageTimes).map(([stage, times]) => ({
        stage,
        avgMinutes: avg(times),
        minMinutes: min(times),
        maxMinutes: max(times),
        sampleCount: times.length,
      }));

      return {
        report,
        totalOrders: byOrder.size,
        completedOrders,
        pendingOrders,
        period: {
          start: input.startDate ?? null,
          end: input.endDate ?? null,
        },
      };
    }),

  /**
   * Lista pedidos aguardando descarregamento no hospital (status = waiting_internal_dock).
   * Usado no filtro do dashboard de expedição.
   */
  listOrdersWaitingDock: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      const orders = await db
        .select({
          id: pickingOrders.id,
          customerOrderNumber: pickingOrders.customerOrderNumber,
          customerName: pickingOrders.customerName,
          status: pickingOrders.status,
          shippedAt: pickingOrders.shippedAt,
          priority: pickingOrders.priority,
        })
        .from(pickingOrders)
        .where(and(
          eq(pickingOrders.tenantId, activeTenantId),
          eq(pickingOrders.status, "waiting_internal_dock"),
        ))
        .orderBy(desc(pickingOrders.shippedAt))
        .limit(input.limit)
        .offset(input.offset);

      return { orders, total: orders.length };
    }),

  /**
   * Lista pedidos com status de rastreio intra-hospitalar para o painel de monitorização.
   */
  listOrdersTracking: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      status: z.enum(["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT", "ARRIVED_UNIT", "RECEIVE_COMPLETE", "PENDING"]).optional(),
      deliveryPointId: z.number().optional(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const isGlobalAdmin = ctx.user.role === "admin" && (ctx.user.tenantId === 1 || ctx.user.tenantId === null);
      const activeTenantId = (isGlobalAdmin && input.tenantId) ? input.tenantId : ctx.user.tenantId;
      if (!activeTenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não identificado" });

      // Buscar o último checkpoint de cada pedido
      const latestLogs = await db.execute(sql`
        SELECT 
          dl.orderId,
          dl.status AS lastStatus,
          dl.timestamp AS lastTimestamp,
          dp.name AS lastPointName,
          dp.type AS lastPointType,
          po.customerOrderNumber,
          po.status AS orderStatus
        FROM deliveryLogs dl
        INNER JOIN (
          SELECT orderId, MAX(timestamp) AS maxTs
          FROM deliveryLogs
          WHERE tenantId = ${activeTenantId}
          GROUP BY orderId
        ) latest ON dl.orderId = latest.orderId AND dl.timestamp = latest.maxTs
        LEFT JOIN deliveryPoints dp ON dl.deliveryPointId = dp.id
        LEFT JOIN pickingOrders po ON dl.orderId = po.id
        WHERE dl.tenantId = ${activeTenantId}
        ${input.status && input.status !== "PENDING" ? sql`AND dl.status = ${input.status}` : sql``}
        ${input.deliveryPointId ? sql`AND dl.deliveryPointId = ${input.deliveryPointId}` : sql``}
        ORDER BY dl.timestamp DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);

      return {
        orders: (latestLogs[0] as unknown) as Array<{
          orderId: number;
          lastStatus: string;
          lastTimestamp: Date;
          lastPointName: string;
          lastPointType: string;
          customerOrderNumber: string | null;
          orderStatus: string;
        }>,
      };
    }),
});
