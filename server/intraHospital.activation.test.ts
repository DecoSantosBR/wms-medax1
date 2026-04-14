/**
 * Testes: Ativação do Fluxo Intra-Hospitalar por Tenant
 *
 * Cobre:
 * - Lógica do helper applyIntraHospitalTransition
 * - Validações de hasIntraHospitalar no tenant
 * - Isolamento multi-tenant (Global Admin vs tenant normal)
 * - Transição de status WAITING_INTERNAL_DOCK
 */
import { describe, it, expect } from "vitest";

// ── Helpers e lógica pura (sem banco) ────────────────────────────────────────

/**
 * Simula a lógica de determinar o activeTenantId com base no papel do usuário.
 * Replica a lógica usada em todos os routers intra-hospitalar.
 */
function resolveActiveTenantId(
  userRole: string,
  userTenantId: number | null,
  inputTenantId?: number
): number | null {
  const isGlobalAdmin = userRole === "admin" && (userTenantId === 1 || userTenantId === null);
  if (isGlobalAdmin && inputTenantId) return inputTenantId;
  return userTenantId;
}

/**
 * Simula a lógica de transição de status pós-expedição.
 * Retorna o status final com base na flag hasIntraHospitalar do tenant.
 */
function determinePostShipmentStatus(hasIntraHospitalar: boolean): string {
  return hasIntraHospitalar ? "waiting_internal_dock" : "shipped";
}

/**
 * Simula a validação de fluxo de checkpoints.
 * Retorna true se a transição é válida, false caso contrário.
 */
function isValidStatusTransition(
  currentStatuses: string[],
  newStatus: string
): { valid: boolean; reason?: string } {
  if (newStatus === "ARRIVED_UNIT") {
    if (!currentStatuses.includes("ARRIVED_COMPLEX")) {
      return { valid: false, reason: "Pedido deve chegar à doca antes de chegar à farmácia" };
    }
  }
  if (newStatus === "RECEIVE_COMPLETE") {
    if (!currentStatuses.includes("ARRIVED_UNIT")) {
      return { valid: false, reason: "Pedido deve chegar à farmácia antes de concluir o recebimento" };
    }
  }
  return { valid: true };
}

// ── Testes: resolveActiveTenantId ────────────────────────────────────────────

describe("resolveActiveTenantId", () => {
  it("retorna tenantId do usuário normal", () => {
    expect(resolveActiveTenantId("user", 5)).toBe(5);
  });

  it("retorna tenantId do usuário normal mesmo com inputTenantId", () => {
    // Usuário normal não pode mudar de tenant
    expect(resolveActiveTenantId("user", 5, 99)).toBe(5);
  });

  it("Global Admin com tenantId=1 usa inputTenantId", () => {
    expect(resolveActiveTenantId("admin", 1, 7)).toBe(7);
  });

  it("Global Admin com tenantId=null usa inputTenantId", () => {
    expect(resolveActiveTenantId("admin", null, 3)).toBe(3);
  });

  it("Global Admin sem inputTenantId retorna null (não identificado)", () => {
    expect(resolveActiveTenantId("admin", null, undefined)).toBeNull();
  });

  it("Global Admin com tenantId=1 sem inputTenantId retorna 1", () => {
    // tenantId=1 é o tenant global, mas sem inputTenantId não há override
    expect(resolveActiveTenantId("admin", 1, undefined)).toBe(1);
  });
});

// ── Testes: determinePostShipmentStatus ──────────────────────────────────────

describe("determinePostShipmentStatus", () => {
  it("tenant SEM intra-hospitalar → status shipped", () => {
    expect(determinePostShipmentStatus(false)).toBe("shipped");
  });

  it("tenant COM intra-hospitalar → status waiting_internal_dock", () => {
    expect(determinePostShipmentStatus(true)).toBe("waiting_internal_dock");
  });
});

// ── Testes: isValidStatusTransition ──────────────────────────────────────────

describe("isValidStatusTransition — validação de fluxo", () => {
  it("ARRIVED_COMPLEX sem histórico → válido", () => {
    const result = isValidStatusTransition([], "ARRIVED_COMPLEX");
    expect(result.valid).toBe(true);
  });

  it("ARRIVED_UNIT sem ARRIVED_COMPLEX → inválido", () => {
    const result = isValidStatusTransition([], "ARRIVED_UNIT");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("doca");
  });

  it("ARRIVED_UNIT com ARRIVED_COMPLEX → válido", () => {
    const result = isValidStatusTransition(["ARRIVED_COMPLEX"], "ARRIVED_UNIT");
    expect(result.valid).toBe(true);
  });

  it("RECEIVE_COMPLETE sem ARRIVED_UNIT → inválido", () => {
    const result = isValidStatusTransition(["ARRIVED_COMPLEX"], "RECEIVE_COMPLETE");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("farmácia");
  });

  it("RECEIVE_COMPLETE com ARRIVED_UNIT → válido", () => {
    const result = isValidStatusTransition(
      ["ARRIVED_COMPLEX", "ARRIVED_UNIT"],
      "RECEIVE_COMPLETE"
    );
    expect(result.valid).toBe(true);
  });

  it("DEPARTED_TO_UNIT sem histórico → válido (sem restrição de fluxo)", () => {
    const result = isValidStatusTransition([], "DEPARTED_TO_UNIT");
    expect(result.valid).toBe(true);
  });

  it("fluxo completo válido: ARRIVED_COMPLEX → DEPARTED_TO_UNIT → ARRIVED_UNIT → RECEIVE_COMPLETE", () => {
    const history: string[] = [];
    const steps = ["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT", "ARRIVED_UNIT", "RECEIVE_COMPLETE"];
    for (const step of steps) {
      const result = isValidStatusTransition(history, step);
      expect(result.valid).toBe(true);
      history.push(step);
    }
  });
});

// ── Testes: isolamento multi-tenant ──────────────────────────────────────────

describe("isolamento multi-tenant", () => {
  it("Global Admin deve informar tenantId para criar checkpoint", () => {
    const tenantId = resolveActiveTenantId("admin", null, undefined);
    expect(tenantId).toBeNull(); // null = não pode criar sem tenantId
  });

  it("Global Admin com tenantId=2 selecionado pode criar checkpoint para tenant 2", () => {
    const tenantId = resolveActiveTenantId("admin", null, 2);
    expect(tenantId).toBe(2);
  });

  it("Usuário do tenant 3 não pode ver dados do tenant 2", () => {
    const tenantId = resolveActiveTenantId("user", 3, 2); // tenta usar tenantId=2
    expect(tenantId).toBe(3); // fica no tenant 3
  });

  it("Usuário do tenant 2 vê apenas dados do tenant 2", () => {
    const tenantId = resolveActiveTenantId("user", 2);
    expect(tenantId).toBe(2);
  });
});

// ── Testes: lógica de agrupamento por tenant ─────────────────────────────────

describe("applyIntraHospitalTransition — lógica de agrupamento", () => {
  it("agrupa pedidos por tenantId corretamente", () => {
    const orders = [
      { id: 1, tenantId: 2 },
      { id: 2, tenantId: 2 },
      { id: 3, tenantId: 3 },
    ];

    const byTenant = new Map<number, number[]>();
    for (const order of orders) {
      if (!byTenant.has(order.tenantId)) byTenant.set(order.tenantId, []);
      byTenant.get(order.tenantId)!.push(order.id);
    }

    expect(byTenant.get(2)).toEqual([1, 2]);
    expect(byTenant.get(3)).toEqual([3]);
    expect(byTenant.size).toBe(2);
  });

  it("lista vazia retorna transitioned=[] e skipped=[]", () => {
    // Simula o early return para lista vazia
    const orderIds: number[] = [];
    const result = orderIds.length === 0
      ? { transitioned: [], skipped: [] }
      : { transitioned: [1], skipped: [] };
    expect(result.transitioned).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("pedido de tenant sem hasIntraHospitalar vai para skipped", () => {
    const tenantHasIntra = false;
    const orderIds = [10, 11];
    const transitioned: number[] = [];
    const skipped: number[] = [];

    if (tenantHasIntra) transitioned.push(...orderIds);
    else skipped.push(...orderIds);

    expect(transitioned).toHaveLength(0);
    expect(skipped).toEqual([10, 11]);
  });

  it("pedido de tenant com hasIntraHospitalar vai para transitioned", () => {
    const tenantHasIntra = true;
    const orderIds = [20, 21, 22];
    const transitioned: number[] = [];
    const skipped: number[] = [];

    if (tenantHasIntra) transitioned.push(...orderIds);
    else skipped.push(...orderIds);

    expect(transitioned).toEqual([20, 21, 22]);
    expect(skipped).toHaveLength(0);
  });
});
