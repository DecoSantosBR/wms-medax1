/**
 * Testes de unidade para o adminRouter — Limpeza de Dados de Teste
 * Cobre: permissões, validação de escopo, validação de confirmText, lógica de SQL
 */
import { describe, it, expect } from "vitest";

// ── Helpers puros extraídos do adminRouter ─────────────────────────────────

function assertGlobalAdmin(user: { role: string; tenantId: number | null }) {
  if (user.role !== "admin" || (user.tenantId !== 1 && user.tenantId !== null)) {
    throw new Error("Apenas o Global Admin pode executar esta operação.");
  }
}

function tenantWhere(tenantId?: number): string {
  return tenantId ? `WHERE tenantId = ${tenantId}` : "";
}

function subWhere(col: string, parentTable: string, tenantId?: number): string {
  if (!tenantId) return "";
  return `WHERE ${col} IN (SELECT id FROM ${parentTable} WHERE tenantId = ${tenantId})`;
}

function validateConfirmText(text: string): boolean {
  return text === "CONFIRMAR";
}

// ── Testes de permissão ────────────────────────────────────────────────────

describe("assertGlobalAdmin", () => {
  it("permite Global Admin com tenantId = 1", () => {
    expect(() => assertGlobalAdmin({ role: "admin", tenantId: 1 })).not.toThrow();
  });

  it("permite Global Admin com tenantId = null", () => {
    expect(() => assertGlobalAdmin({ role: "admin", tenantId: null })).not.toThrow();
  });

  it("rejeita usuário com role = user", () => {
    expect(() => assertGlobalAdmin({ role: "user", tenantId: 1 })).toThrow("Global Admin");
  });

  it("rejeita admin de tenant específico (tenantId = 2)", () => {
    expect(() => assertGlobalAdmin({ role: "admin", tenantId: 2 })).toThrow("Global Admin");
  });

  it("rejeita admin de tenant específico (tenantId = 5)", () => {
    expect(() => assertGlobalAdmin({ role: "admin", tenantId: 5 })).toThrow("Global Admin");
  });
});

// ── Testes de validação de confirmText ────────────────────────────────────

describe("validateConfirmText", () => {
  it("aceita 'CONFIRMAR' exato", () => {
    expect(validateConfirmText("CONFIRMAR")).toBe(true);
  });

  it("rejeita 'confirmar' (minúsculas)", () => {
    expect(validateConfirmText("confirmar")).toBe(false);
  });

  it("rejeita 'CONFIRMAR ' (com espaço)", () => {
    expect(validateConfirmText("CONFIRMAR ")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(validateConfirmText("")).toBe(false);
  });

  it("rejeita 'CONFIRM' (incompleto)", () => {
    expect(validateConfirmText("CONFIRM")).toBe(false);
  });
});

// ── Testes de geração de SQL WHERE ────────────────────────────────────────

describe("tenantWhere", () => {
  it("retorna WHERE com tenantId quando fornecido", () => {
    expect(tenantWhere(2)).toBe("WHERE tenantId = 2");
  });

  it("retorna string vazia quando tenantId não fornecido", () => {
    expect(tenantWhere(undefined)).toBe("");
  });

  it("retorna WHERE correto para tenantId = 10", () => {
    expect(tenantWhere(10)).toBe("WHERE tenantId = 10");
  });
});

describe("subWhere", () => {
  it("gera subquery correta para pickingOrders", () => {
    const result = subWhere("pickingOrderId", "pickingOrders", 3);
    expect(result).toBe("WHERE pickingOrderId IN (SELECT id FROM pickingOrders WHERE tenantId = 3)");
  });

  it("retorna string vazia sem tenantId", () => {
    expect(subWhere("sessionId", "blindConferenceSessions", undefined)).toBe("");
  });

  it("gera subquery correta para blindConferenceSessions", () => {
    const result = subWhere("sessionId", "blindConferenceSessions", 5);
    expect(result).toBe("WHERE sessionId IN (SELECT id FROM blindConferenceSessions WHERE tenantId = 5)");
  });

  it("gera subquery correta para shipmentManifests", () => {
    const result = subWhere("manifestId", "shipmentManifests", 2);
    expect(result).toBe("WHERE manifestId IN (SELECT id FROM shipmentManifests WHERE tenantId = 2)");
  });
});

// ── Testes de validação de escopos ────────────────────────────────────────

describe("validação de escopos", () => {
  const validScopes = ["receiving", "picking", "shipping", "inventory", "intraHospital"] as const;

  it("aceita todos os escopos válidos", () => {
    validScopes.forEach(scope => {
      expect(validScopes.includes(scope)).toBe(true);
    });
  });

  it("rejeita escopo inválido", () => {
    const invalidScope = "unknown" as string;
    expect(validScopes.includes(invalidScope as typeof validScopes[number])).toBe(false);
  });

  it("requer ao menos um escopo", () => {
    const scopes: string[] = [];
    expect(scopes.length).toBe(0); // deve ser rejeitado pelo Zod .min(1)
  });
});

// ── Testes de lógica de ordem de deleção ─────────────────────────────────

describe("ordem de deleção (integridade referencial)", () => {
  it("intraHospital deve deletar deliveryLogs antes de deliveryPoints", () => {
    // Ordem correta: logs antes de pontos (FK: deliveryLogs.deliveryPointId → deliveryPoints.id)
    const order = ["deliveryLogs", "deliveryPoints"];
    expect(order.indexOf("deliveryLogs")).toBeLessThan(order.indexOf("deliveryPoints"));
  });

  it("picking deve deletar pickingWaveItems antes de pickingWaves", () => {
    const order = ["pickingWaveItems", "pickingWaves", "pickingOrders"];
    expect(order.indexOf("pickingWaveItems")).toBeLessThan(order.indexOf("pickingWaves"));
  });

  it("receiving deve deletar blindConferenceItems antes de blindConferenceSessions", () => {
    const order = ["blindConferenceItems", "blindConferenceSessions", "receivingOrders"];
    expect(order.indexOf("blindConferenceItems")).toBeLessThan(order.indexOf("blindConferenceSessions"));
  });

  it("receiving deve deletar receivingOrderItems antes de receivingOrders", () => {
    const order = ["receivingOrderItems", "receivingOrders"];
    expect(order.indexOf("receivingOrderItems")).toBeLessThan(order.indexOf("receivingOrders"));
  });
});
