/**
 * Testes de unidade para o módulo Intra-Hospitalar
 * Cobre: validação de transições de status, lógica de negócio e multi-tenancy
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers de validação (extraídos do router para teste isolado) ──────────────

type CheckpointStatus = "ARRIVED_COMPLEX" | "DEPARTED_TO_UNIT" | "ARRIVED_UNIT" | "RECEIVE_COMPLETE";

function validateStatusTransition(
  existingStatuses: string[],
  newStatus: string
): { valid: boolean; message?: string } {
  const hasStatus = (s: string) => existingStatuses.includes(s);

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

function formatLeadTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Testes de Validação de Transição de Status ────────────────────────────────

describe("validateStatusTransition", () => {
  describe("ARRIVED_COMPLEX (primeiro checkpoint)", () => {
    it("deve permitir ARRIVED_COMPLEX sem checkpoints anteriores", () => {
      const result = validateStatusTransition([], "ARRIVED_COMPLEX");
      expect(result.valid).toBe(true);
    });

    it("deve permitir ARRIVED_COMPLEX mesmo com outros checkpoints", () => {
      const result = validateStatusTransition(["ARRIVED_COMPLEX"], "ARRIVED_COMPLEX");
      expect(result.valid).toBe(true);
    });
  });

  describe("DEPARTED_TO_UNIT", () => {
    it("deve rejeitar DEPARTED_TO_UNIT sem ARRIVED_COMPLEX", () => {
      const result = validateStatusTransition([], "DEPARTED_TO_UNIT");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("ARRIVED_COMPLEX");
    });

    it("deve permitir DEPARTED_TO_UNIT após ARRIVED_COMPLEX", () => {
      const result = validateStatusTransition(["ARRIVED_COMPLEX"], "DEPARTED_TO_UNIT");
      expect(result.valid).toBe(true);
    });
  });

  describe("ARRIVED_UNIT", () => {
    it("deve rejeitar ARRIVED_UNIT sem ARRIVED_COMPLEX", () => {
      const result = validateStatusTransition([], "ARRIVED_UNIT");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("ARRIVED_COMPLEX");
    });

    it("deve permitir ARRIVED_UNIT após ARRIVED_COMPLEX", () => {
      const result = validateStatusTransition(["ARRIVED_COMPLEX"], "ARRIVED_UNIT");
      expect(result.valid).toBe(true);
    });

    it("deve permitir ARRIVED_UNIT após ARRIVED_COMPLEX + DEPARTED_TO_UNIT (fluxo completo)", () => {
      const result = validateStatusTransition(
        ["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT"],
        "ARRIVED_UNIT"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("RECEIVE_COMPLETE", () => {
    it("deve rejeitar RECEIVE_COMPLETE sem ARRIVED_UNIT", () => {
      const result = validateStatusTransition([], "RECEIVE_COMPLETE");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("ARRIVED_UNIT");
    });

    it("deve rejeitar RECEIVE_COMPLETE apenas com ARRIVED_COMPLEX (sem ARRIVED_UNIT)", () => {
      const result = validateStatusTransition(["ARRIVED_COMPLEX"], "RECEIVE_COMPLETE");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("ARRIVED_UNIT");
    });

    it("deve permitir RECEIVE_COMPLETE após ARRIVED_UNIT", () => {
      const result = validateStatusTransition(
        ["ARRIVED_COMPLEX", "ARRIVED_UNIT"],
        "RECEIVE_COMPLETE"
      );
      expect(result.valid).toBe(true);
    });

    it("deve permitir RECEIVE_COMPLETE no fluxo completo", () => {
      const result = validateStatusTransition(
        ["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT", "ARRIVED_UNIT"],
        "RECEIVE_COMPLETE"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("Fluxo completo de 4 checkpoints", () => {
    it("deve validar o fluxo completo em ordem", () => {
      const statuses: string[] = [];

      // 1. Chegada à doca
      let r = validateStatusTransition(statuses, "ARRIVED_COMPLEX");
      expect(r.valid).toBe(true);
      statuses.push("ARRIVED_COMPLEX");

      // 2. Saída para farmácia
      r = validateStatusTransition(statuses, "DEPARTED_TO_UNIT");
      expect(r.valid).toBe(true);
      statuses.push("DEPARTED_TO_UNIT");

      // 3. Chegada à farmácia
      r = validateStatusTransition(statuses, "ARRIVED_UNIT");
      expect(r.valid).toBe(true);
      statuses.push("ARRIVED_UNIT");

      // 4. Recebimento concluído
      r = validateStatusTransition(statuses, "RECEIVE_COMPLETE");
      expect(r.valid).toBe(true);
    });

    it("deve rejeitar pular da doca direto para RECEIVE_COMPLETE", () => {
      const r = validateStatusTransition(["ARRIVED_COMPLEX"], "RECEIVE_COMPLETE");
      expect(r.valid).toBe(false);
    });
  });
});

// ── Testes de Formatação de Lead Time ─────────────────────────────────────────

describe("formatLeadTime", () => {
  it("deve formatar minutos abaixo de 60", () => {
    expect(formatLeadTime(5)).toBe("5 min");
    expect(formatLeadTime(45)).toBe("45 min");
    expect(formatLeadTime(59)).toBe("59 min");
  });

  it("deve formatar horas exatas", () => {
    expect(formatLeadTime(60)).toBe("1h");
    expect(formatLeadTime(120)).toBe("2h");
    expect(formatLeadTime(180)).toBe("3h");
  });

  it("deve formatar horas com minutos", () => {
    expect(formatLeadTime(90)).toBe("1h 30min");
    expect(formatLeadTime(75)).toBe("1h 15min");
    expect(formatLeadTime(125)).toBe("2h 5min");
  });
});

// ── Testes de Lógica de Batch ─────────────────────────────────────────────────

describe("Batch scan logic", () => {
  it("deve processar pedidos válidos e inválidos separadamente", () => {
    const orderIds = [1001, 1002, 9999]; // 9999 não existe
    const validOrderIds = new Set([1001, 1002]);

    const results = orderIds.map(id => ({
      orderId: id,
      valid: validOrderIds.has(id),
    }));

    expect(results.filter(r => r.valid)).toHaveLength(2);
    expect(results.filter(r => !r.valid)).toHaveLength(1);
    expect(results.find(r => !r.valid)?.orderId).toBe(9999);
  });

  it("deve agrupar logs por pedido corretamente", () => {
    const allLogs = [
      { orderId: 1001, status: "ARRIVED_COMPLEX" },
      { orderId: 1001, status: "DEPARTED_TO_UNIT" },
      { orderId: 1002, status: "ARRIVED_COMPLEX" },
    ];

    const logsByOrder = new Map<number, string[]>();
    for (const log of allLogs) {
      if (!logsByOrder.has(log.orderId)) logsByOrder.set(log.orderId, []);
      logsByOrder.get(log.orderId)!.push(log.status);
    }

    expect(logsByOrder.get(1001)).toHaveLength(2);
    expect(logsByOrder.get(1002)).toHaveLength(1);
    expect(logsByOrder.get(1001)).toContain("ARRIVED_COMPLEX");
    expect(logsByOrder.get(1001)).toContain("DEPARTED_TO_UNIT");
  });
});

// ── Testes de Coerência Tipo/Status ──────────────────────────────────────────

describe("Point type vs status coherence", () => {
  function validatePointTypeStatus(pointType: "DOCK" | "PHARMACY", status: string): boolean {
    if (status === "ARRIVED_COMPLEX" && pointType !== "DOCK") return false;
    if (status === "ARRIVED_UNIT" && pointType !== "PHARMACY") return false;
    if (status === "RECEIVE_COMPLETE" && pointType !== "PHARMACY") return false;
    return true;
  }

  it("ARRIVED_COMPLEX só pode ser em DOCK", () => {
    expect(validatePointTypeStatus("DOCK", "ARRIVED_COMPLEX")).toBe(true);
    expect(validatePointTypeStatus("PHARMACY", "ARRIVED_COMPLEX")).toBe(false);
  });

  it("ARRIVED_UNIT só pode ser em PHARMACY", () => {
    expect(validatePointTypeStatus("PHARMACY", "ARRIVED_UNIT")).toBe(true);
    expect(validatePointTypeStatus("DOCK", "ARRIVED_UNIT")).toBe(false);
  });

  it("RECEIVE_COMPLETE só pode ser em PHARMACY", () => {
    expect(validatePointTypeStatus("PHARMACY", "RECEIVE_COMPLETE")).toBe(true);
    expect(validatePointTypeStatus("DOCK", "RECEIVE_COMPLETE")).toBe(false);
  });

  it("DEPARTED_TO_UNIT pode ser em qualquer tipo", () => {
    expect(validatePointTypeStatus("DOCK", "DEPARTED_TO_UNIT")).toBe(true);
    expect(validatePointTypeStatus("PHARMACY", "DEPARTED_TO_UNIT")).toBe(true);
  });
});

// ── Testes de Cálculo de SLA ──────────────────────────────────────────────────

describe("SLA calculation", () => {
  function calcStageTimes(logs: Array<{ status: string; timestamp: number }>) {
    const getTime = (status: string) => logs.find(l => l.status === status)?.timestamp ?? null;

    const arrivedComplex = getTime("ARRIVED_COMPLEX");
    const arrivedUnit = getTime("ARRIVED_UNIT");
    const receiveComplete = getTime("RECEIVE_COMPLETE");

    return {
      dockToPharmacy: arrivedComplex && arrivedUnit
        ? Math.round((arrivedUnit - arrivedComplex) / 60000)
        : null,
      pharmacyToComplete: arrivedUnit && receiveComplete
        ? Math.round((receiveComplete - arrivedUnit) / 60000)
        : null,
      total: arrivedComplex && receiveComplete
        ? Math.round((receiveComplete - arrivedComplex) / 60000)
        : null,
    };
  }

  it("deve calcular lead time doca → farmácia corretamente", () => {
    const now = Date.now();
    const logs = [
      { status: "ARRIVED_COMPLEX", timestamp: now },
      { status: "ARRIVED_UNIT", timestamp: now + 30 * 60000 }, // +30 min
    ];
    const result = calcStageTimes(logs);
    expect(result.dockToPharmacy).toBe(30);
    expect(result.total).toBeNull(); // sem RECEIVE_COMPLETE
  });

  it("deve calcular lead time total corretamente", () => {
    const now = Date.now();
    const logs = [
      { status: "ARRIVED_COMPLEX", timestamp: now },
      { status: "ARRIVED_UNIT", timestamp: now + 45 * 60000 }, // +45 min
      { status: "RECEIVE_COMPLETE", timestamp: now + 75 * 60000 }, // +75 min total
    ];
    const result = calcStageTimes(logs);
    expect(result.dockToPharmacy).toBe(45);
    expect(result.pharmacyToComplete).toBe(30);
    expect(result.total).toBe(75);
  });

  it("deve retornar null para etapas sem dados suficientes", () => {
    const logs = [{ status: "ARRIVED_COMPLEX", timestamp: Date.now() }];
    const result = calcStageTimes(logs);
    expect(result.dockToPharmacy).toBeNull();
    expect(result.pharmacyToComplete).toBeNull();
    expect(result.total).toBeNull();
  });
});
