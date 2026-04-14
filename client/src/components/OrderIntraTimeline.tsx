/**
 * OrderIntraTimeline
 * Exibe a timeline vertical de checkpoints intra-hospitalares de um pedido.
 * Pode ser embutido como aba no detalhe de qualquer pedido.
 */
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2,
  Clock,
  Truck,
  Building2,
  Package,
  ArrowDownCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

// ── Configurações de status ───────────────────────────────────────────────────

type CheckpointStatus = "ARRIVED_COMPLEX" | "DEPARTED_TO_UNIT" | "ARRIVED_UNIT" | "RECEIVE_COMPLETE";

const STATUS_CONFIG: Record<CheckpointStatus, {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  ARRIVED_COMPLEX: {
    label: "Chegada à Doca",
    icon: Truck,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
    borderColor: "border-orange-300",
  },
  DEPARTED_TO_UNIT: {
    label: "Saída para Farmácia",
    icon: ArrowDownCircle,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    borderColor: "border-blue-300",
  },
  ARRIVED_UNIT: {
    label: "Chegada à Farmácia",
    icon: Building2,
    color: "text-green-600",
    bgColor: "bg-green-100",
    borderColor: "border-green-300",
  },
  RECEIVE_COMPLETE: {
    label: "Recebimento Concluído",
    icon: CheckCircle2,
    color: "text-purple-600",
    bgColor: "bg-purple-100",
    borderColor: "border-purple-300",
  },
};

// Todos os 5 momentos esperados (incluindo DEPARTED_TO_UNIT como opcional)
const EXPECTED_STATUSES: CheckpointStatus[] = [
  "ARRIVED_COMPLEX",
  "DEPARTED_TO_UNIT",
  "ARRIVED_UNIT",
  "RECEIVE_COMPLETE",
];

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLeadTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OrderIntraTimelineProps {
  orderId: number;
  tenantId?: number;
  compact?: boolean;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function OrderIntraTimeline({ orderId, tenantId, compact = false }: OrderIntraTimelineProps) {
  const { data, isLoading, error } = trpc.intraHospital.getOrderTimeline.useQuery(
    { orderId, tenantId },
    { refetchInterval: 30000 } // Atualiza a cada 30s para monitorização em tempo real
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando rastreio...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm p-4">
        <AlertTriangle className="h-4 w-4" />
        Erro ao carregar rastreio: {error.message}
      </div>
    );
  }

  if (!data || data.timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-24 text-gray-400 gap-2">
        <Package className="h-8 w-8 opacity-40" />
        <p className="text-sm">Nenhum checkpoint registrado para este pedido</p>
        <p className="text-xs text-gray-300">O rastreio intra-hospitalar ainda não foi iniciado</p>
      </div>
    );
  }

  const registeredStatuses = new Set(data.timeline.map(t => t.status));

  return (
    <div className="space-y-4">
      {/* Resumo de status */}
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-1.5 text-sm font-medium ${data.isComplete ? "text-purple-600" : "text-blue-600"}`}>
            {data.isComplete
              ? <><CheckCircle2 className="h-4 w-4" /> Recebimento Concluído</>
              : <><Clock className="h-4 w-4" /> Em Trânsito</>}
          </div>
          {data.totalLeadTimeMinutes !== null && (
            <Badge variant="outline" className="text-xs">
              Tempo total: {formatLeadTime(data.totalLeadTimeMinutes)}
            </Badge>
          )}
        </div>
      )}

      {/* Timeline vertical */}
      <div className="relative">
        {/* Linha vertical conectora */}
        <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-200" />

        <div className="space-y-4">
          {EXPECTED_STATUSES.map((status, index) => {
            const config = STATUS_CONFIG[status];
            const Icon = config.icon;
            const log = data.timeline.find(t => t.status === status);
            const isRegistered = registeredStatuses.has(status);
            const isPending = !isRegistered;

            return (
              <div key={status} className="relative flex gap-4">
                {/* Ícone do checkpoint */}
                <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isRegistered
                    ? `${config.bgColor} ${config.borderColor}`
                    : "bg-gray-100 border-gray-200"
                }`}>
                  <Icon className={`h-5 w-5 ${isRegistered ? config.color : "text-gray-300"}`} />
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <p className={`font-medium text-sm ${isPending ? "text-gray-400" : "text-gray-900"}`}>
                        {config.label}
                        {status === "DEPARTED_TO_UNIT" && (
                          <span className="ml-1 text-xs text-gray-400">(opcional)</span>
                        )}
                      </p>
                      {isRegistered && log && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatDateTime(log.timestamp)}
                          {log.pointName && (
                            <span className="ml-1 text-gray-400">· {log.pointName}</span>
                          )}
                        </p>
                      )}
                      {isRegistered && log?.userName && (
                        <p className="text-xs text-gray-400">
                          Operador: {log.userName}
                        </p>
                      )}
                      {isRegistered && log?.notes && (
                        <p className="text-xs text-gray-500 italic mt-0.5">"{log.notes}"</p>
                      )}
                      {isPending && (
                        <p className="text-xs text-gray-300">Aguardando...</p>
                      )}
                    </div>

                    {/* Lead time entre checkpoints */}
                    {isRegistered && log?.leadTimeMinutes !== null && log?.leadTimeMinutes !== undefined && index > 0 && (
                      <Badge variant="outline" className="text-xs shrink-0 text-gray-500">
                        +{formatLeadTime(log.leadTimeMinutes)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alerta: chegou à farmácia sem passar pela doca */}
      {data.hasPharmacyArrival && !data.hasDockedArrival && (
        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Este pedido chegou à farmácia sem registro de chegada à doca de descarregamento.</span>
        </div>
      )}
    </div>
  );
}
