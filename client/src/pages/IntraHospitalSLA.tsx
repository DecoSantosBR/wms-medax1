/**
 * IntraHospitalSLA
 * Relatório de Tempo Médio de Trânsito Interno (SLA Intra-Hospitalar).
 * Exibe métricas de lead time por etapa e lista de pedidos em rastreio.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OrderIntraTimeline } from "@/components/OrderIntraTimeline";
import {
  BarChart3,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
  Eye,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLeadTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABELS: Record<string, string> = {
  ARRIVED_COMPLEX: "Chegada à Doca",
  DEPARTED_TO_UNIT: "Saída para Farmácia",
  ARRIVED_UNIT: "Chegada à Farmácia",
  RECEIVE_COMPLETE: "Recebimento Concluído",
};

const STATUS_COLORS: Record<string, string> = {
  ARRIVED_COMPLEX: "bg-orange-100 text-orange-700",
  DEPARTED_TO_UNIT: "bg-blue-100 text-blue-700",
  ARRIVED_UNIT: "bg-green-100 text-green-700",
  RECEIVE_COMPLETE: "bg-purple-100 text-purple-700",
};

// ── Componente Principal ──────────────────────────────────────────────────────

export default function IntraHospitalSLA() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin" && (user?.tenantId === 1 || user?.tenantId === null);

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [timelineOrderId, setTimelineOrderId] = useState<number | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(undefined);

  const { data: tenantsList } = trpc.tenants.list.useQuery(undefined, { enabled: isGlobalAdmin });

  const { data: slaData, isLoading: slaLoading, refetch: refetchSla } = trpc.intraHospital.getSlaReport.useQuery({
    startDate,
    endDate,
    tenantId: isGlobalAdmin ? selectedTenantId : undefined,
  }, { enabled: !isGlobalAdmin || selectedTenantId !== undefined });

  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.intraHospital.listOrdersTracking.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter as "ARRIVED_COMPLEX" | "DEPARTED_TO_UNIT" | "ARRIVED_UNIT" | "RECEIVE_COMPLETE",
    limit: 50,
    tenantId: isGlobalAdmin ? selectedTenantId : undefined,
  }, { enabled: !isGlobalAdmin || selectedTenantId !== undefined });

  function handleRefresh() {
    refetchSla();
    refetchOrders();
  }

  const orders = (ordersData?.orders ?? []) as Array<{
    orderId: number;
    lastStatus: string;
    lastTimestamp: Date;
    lastPointName: string;
    lastPointType: string;
    customerOrderNumber: string | null;
    orderStatus: string;
  }>;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              SLA Intra-Hospitalar
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Tempo médio de trânsito interno e monitorização de pedidos
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>

        {/* Tenant Selector (Global Admin) */}
        {isGlobalAdmin && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <Label className="text-sm font-medium text-amber-800 whitespace-nowrap">Cliente (obrigatório):</Label>
                <Select
                  value={selectedTenantId?.toString() ?? ""}
                  onValueChange={(v) => setSelectedTenantId(v ? Number(v) : undefined)}
                >
                  <SelectTrigger className="w-72 border-amber-300">
                    <SelectValue placeholder="Selecione o cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(tenantsList ?? []).filter(t => t.hasIntraHospitalar).map(t => (
                      <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTenantId && (
                  <span className="text-xs text-amber-700">Visualizando dados do cliente selecionado</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filtro de período */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <Label className="text-xs text-gray-500">Data Início</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Data Fim</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
              </div>
              <Button onClick={() => refetchSla()} variant="default" size="sm">
                Aplicar Filtro
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* KPIs de resumo */}
        {slaData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-gray-500">Total de Pedidos</span>
                </div>
                <p className="text-2xl font-bold">{slaData.totalOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-gray-500">Concluídos</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{slaData.completedOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <span className="text-xs text-gray-500">Em Andamento</span>
                </div>
                <p className="text-2xl font-bold text-orange-600">{slaData.pendingOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="h-4 w-4 text-purple-500" />
                  <span className="text-xs text-gray-500">Tempo Médio Total</span>
                </div>
                <p className="text-2xl font-bold text-purple-600">
                  {formatLeadTime(slaData.report.find(r => r.stage === "Total (Doca → Recebimento)")?.avgMinutes ?? null)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabela de SLA por etapa */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Tempo Médio por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {slaLoading ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-sm">Carregando...</div>
            ) : !slaData || slaData.report.every(r => r.sampleCount === 0) ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                Nenhum dado disponível para o período selecionado
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-center">Média</TableHead>
                    <TableHead className="text-center">Mínimo</TableHead>
                    <TableHead className="text-center">Máximo</TableHead>
                    <TableHead className="text-center">Amostras</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slaData.report.map(row => (
                    <TableRow key={row.stage}>
                      <TableCell className="font-medium">{row.stage}</TableCell>
                      <TableCell className="text-center">
                        <span className={`font-bold ${
                          row.avgMinutes === null ? "text-gray-400" :
                          row.avgMinutes > 120 ? "text-red-600" :
                          row.avgMinutes > 60 ? "text-orange-600" : "text-green-600"
                        }`}>
                          {formatLeadTime(row.avgMinutes)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-gray-500 text-sm">
                        {formatLeadTime(row.minMinutes)}
                      </TableCell>
                      <TableCell className="text-center text-gray-500 text-sm">
                        {formatLeadTime(row.maxMinutes)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{row.sampleCount}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Lista de pedidos em rastreio */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Pedidos em Rastreio
              </CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos os status</SelectItem>
                  <SelectItem value="ARRIVED_COMPLEX">Chegada à Doca</SelectItem>
                  <SelectItem value="DEPARTED_TO_UNIT">Saída para Farmácia</SelectItem>
                  <SelectItem value="ARRIVED_UNIT">Chegada à Farmácia</SelectItem>
                  <SelectItem value="RECEIVE_COMPLETE">Recebimento Concluído</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {ordersLoading ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-sm">Carregando...</div>
            ) : orders.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                Nenhum pedido em rastreio
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Último Status</TableHead>
                    <TableHead>Último Ponto</TableHead>
                    <TableHead>Última Atualização</TableHead>
                    <TableHead className="text-right">Rastreio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map(order => (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-mono font-medium">
                        #{order.orderId}
                        {order.customerOrderNumber && (
                          <span className="ml-1 text-xs text-gray-400">({order.customerOrderNumber})</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[order.lastStatus] ?? "bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABELS[order.lastStatus] ?? order.lastStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {order.lastPointName ?? "—"}
                        {order.lastPointType && (
                          <span className="ml-1 text-xs text-gray-400">
                            ({order.lastPointType === "DOCK" ? "Doca" : "Farmácia"})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {formatDateTime(order.lastTimestamp)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setTimelineOrderId(order.orderId)}
                          className="gap-1"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal de Timeline do Pedido */}
      <Dialog open={timelineOrderId !== null} onOpenChange={() => setTimelineOrderId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Rastreio Intra-Hospitalar — Pedido #{timelineOrderId}
            </DialogTitle>
          </DialogHeader>
          {timelineOrderId && (
            <OrderIntraTimeline orderId={timelineOrderId} />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
