import { useState, useRef, useEffect } from "react";
import { CollectorLayout } from "../../components/CollectorLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  QrCode,
  Building2,
  Package,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  X,
  ScanLine,
  Loader2,
  ChevronLeft,
  Hash,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type DeliveryPoint = {
  id: number;
  name: string;
  type: "DOCK" | "PHARMACY";
  externalCode: string;
  description: string | null;
};

type ScanStep = "scan_point" | "select_action" | "scan_orders" | "confirm" | "done";

type ActionType = "ARRIVED_COMPLEX" | "DEPARTED_TO_UNIT" | "ARRIVED_UNIT" | "RECEIVE_COMPLETE";

type ScannedOrder = {
  id: number;
  input: string; // O que o operador bipou/digitou
  resolved: boolean;
  error?: string;
};

const STATUS_LABELS: Record<ActionType, string> = {
  ARRIVED_COMPLEX: "Chegada à Doca",
  DEPARTED_TO_UNIT: "Saída para Farmácia",
  ARRIVED_UNIT: "Chegada à Farmácia",
  RECEIVE_COMPLETE: "Recebimento Concluído",
};

const STATUS_COLORS: Record<ActionType, string> = {
  ARRIVED_COMPLEX: "bg-orange-100 text-orange-700 border-orange-200",
  DEPARTED_TO_UNIT: "bg-blue-100 text-blue-700 border-blue-200",
  ARRIVED_UNIT: "bg-green-100 text-green-700 border-green-200",
  RECEIVE_COMPLETE: "bg-purple-100 text-purple-700 border-purple-200",
};

// Ações disponíveis por tipo de ponto
const DOCK_ACTIONS: ActionType[] = ["ARRIVED_COMPLEX", "DEPARTED_TO_UNIT"];
const PHARMACY_ACTIONS: ActionType[] = ["ARRIVED_UNIT", "RECEIVE_COMPLETE"];

// ── Componente Principal ──────────────────────────────────────────────────────

export function CollectorIntraHospital() {
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin" && (user?.tenantId === 1 || user?.tenantId === null);

  const [step, setStep] = useState<ScanStep>("scan_point");
  const [pointCode, setPointCode] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<DeliveryPoint | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [orderInput, setOrderInput] = useState("");
  const [scannedOrders, setScannedOrders] = useState<ScannedOrder[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    successCount: number;
    errorCount: number;
    results: Array<{ orderId: number; orderNumber: string | null; success: boolean; error?: string; warning?: string }>;
  } | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(undefined);

  const pointInputRef = useRef<HTMLInputElement>(null);
  const orderInputRef = useRef<HTMLInputElement>(null);

  // Buscar lista de tenants para o Tenant Selector (Global Admin)
  const { data: tenantsList } = trpc.tenants.list.useQuery(undefined, { enabled: isGlobalAdmin });

  // Auto-focus nos inputs
  useEffect(() => {
    if (step === "scan_point") pointInputRef.current?.focus();
    if (step === "scan_orders") orderInputRef.current?.focus();
  }, [step]);

  // Buscar ponto por código
  const getPointQuery = trpc.intraHospital.getDeliveryPointByCode.useQuery(
    { externalCode: pointCode, tenantId: isGlobalAdmin ? selectedTenantId : undefined },
    {
      enabled: false,
      retry: false,
    }
  );

  const batchMut = trpc.intraHospital.batchScanCheckpoint.useMutation();

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleScanPoint() {
    if (!pointCode.trim()) return;
    try {
      const result = await getPointQuery.refetch();
      if (result.data) {
        setSelectedPoint(result.data);
        setStep("select_action");
      } else {
        toast.error(`Ponto não encontrado: ${pointCode}`);
      }
    } catch {
      toast.error(`Ponto não encontrado: ${pointCode}`);
    }
  }

  function handleSelectAction(action: ActionType) {
    setSelectedAction(action);
    setScannedOrders([]);
    setStep("scan_orders");
  }

  function handleAddOrder() {
    const val = orderInput.trim();
    if (!val) return;

    // Verificar duplicata
    if (scannedOrders.some(o => o.input === val)) {
      toast.error("Pedido já adicionado");
      setOrderInput("");
      return;
    }

    // Tentar parsear como número (ID do pedido)
    const orderId = parseInt(val, 10);
    if (isNaN(orderId)) {
      toast.error("Código de pedido inválido. Digite o número do pedido");
      setOrderInput("");
      return;
    }

    setScannedOrders(prev => [...prev, { id: orderId, input: val, resolved: true }]);
    setOrderInput("");
    orderInputRef.current?.focus();

    // Vibração háptica de sucesso
    if (navigator.vibrate) navigator.vibrate(50);
  }

  function handleRemoveOrder(input: string) {
    setScannedOrders(prev => prev.filter(o => o.input !== input));
  }

  async function handleConfirm() {
    if (!selectedPoint || !selectedAction || scannedOrders.length === 0) return;

    setIsSubmitting(true);
    try {
      const orderIds = scannedOrders.filter(o => o.resolved).map(o => o.id);
      const result = await batchMut.mutateAsync({
        orderIds,
        deliveryPointId: selectedPoint.id,
        status: selectedAction,
      });

      setBatchResult(result);
      setStep("done");

      if (navigator.vibrate) navigator.vibrate(result.errorCount > 0 ? [100, 50, 100] : [200]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao registrar checkpoints";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setStep("scan_point");
    setPointCode("");
    setSelectedPoint(null);
    setSelectedAction(null);
    setOrderInput("");
    setScannedOrders([]);
    setBatchResult(null);
  }

  function handleNewBatch() {
    setStep("scan_orders");
    setOrderInput("");
    setScannedOrders([]);
    setBatchResult(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const availableActions = selectedPoint?.type === "DOCK" ? DOCK_ACTIONS : PHARMACY_ACTIONS;

  return (
    <CollectorLayout title="Rastreio Intra-Hospitalar">
      <div className="space-y-4 pb-6">

        {/* Tenant Selector (Global Admin) */}
        {isGlobalAdmin && (
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium text-amber-800 whitespace-nowrap">Cliente:</Label>
                <Select
                  value={selectedTenantId?.toString() ?? ""}
                  onValueChange={(v) => setSelectedTenantId(v ? Number(v) : undefined)}
                >
                  <SelectTrigger className="h-8 text-xs border-amber-300">
                    <SelectValue placeholder="Selecione o cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(tenantsList ?? []).filter(t => t.hasIntraHospitalar).map(t => (
                      <SelectItem key={t.id} value={t.id.toString()} className="text-xs">{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isGlobalAdmin && !selectedTenantId && (
                <p className="text-xs text-amber-700 mt-1">Selecione um cliente para iniciar o rastreio.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Indicador de progresso */}
        <div className="flex items-center gap-2 px-1">
          {(["scan_point", "select_action", "scan_orders", "confirm", "done"] as ScanStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? "bg-blue-600 text-white scale-110" :
                ["scan_point", "select_action", "scan_orders", "confirm", "done"].indexOf(step) > i
                  ? "bg-green-500 text-white" : "bg-white/30 text-white/60"
              }`}>
                {["scan_point", "select_action", "scan_orders", "confirm", "done"].indexOf(step) > i
                  ? "✓" : i + 1}
              </div>
              {i < 4 && <div className="w-4 h-0.5 bg-white/30" />}
            </div>
          ))}
        </div>

        {/* ── PASSO 1: Scan do Ponto ── */}
        {step === "scan_point" && (
          <Card className="bg-white/95">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <QrCode className="h-5 w-5 text-blue-600" />
                Passo 1: Identificar Ponto de Entrega
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Bipe o QR Code do ponto de entrega (doca ou farmácia) ou digite o código manualmente.
              </p>
              <div className="flex gap-2">
                <Input
                  ref={pointInputRef}
                  value={pointCode}
                  onChange={e => setPointCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && handleScanPoint()}
                  placeholder="Ex: DOCA-A ou FARM-CENTRAL"
                  className="font-mono text-lg h-12"
                  autoComplete="off"
                />
                <Button onClick={handleScanPoint} className="h-12 px-6" disabled={!pointCode.trim()}>
                  <ScanLine className="h-5 w-5" />
                </Button>
              </div>
              {getPointQuery.isFetching && (
                <div className="flex items-center gap-2 text-blue-600 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando ponto...
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── PASSO 2: Selecionar Ação ── */}
        {step === "select_action" && selectedPoint && (
          <div className="space-y-3">
            <Card className="bg-white/95">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedPoint.type === "DOCK" ? "bg-orange-100" : "bg-green-100"}`}>
                    {selectedPoint.type === "DOCK"
                      ? <Package className="h-5 w-5 text-orange-600" />
                      : <Building2 className="h-5 w-5 text-green-600" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{selectedPoint.name}</p>
                    <p className="text-xs text-gray-500">
                      {selectedPoint.type === "DOCK" ? "🚚 Doca de Descarregamento" : "🏥 Farmácia Interna"}
                      {" · "}<code className="font-mono">{selectedPoint.externalCode}</code>
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setStep("scan_point")}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/95">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Passo 2: Selecionar Ação</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {availableActions.map(action => (
                  <button
                    key={action}
                    onClick={() => handleSelectAction(action)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-all hover:scale-[1.01] active:scale-[0.99] ${STATUS_COLORS[action]}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{STATUS_LABELS[action]}</p>
                        <p className="text-xs opacity-70 mt-0.5">
                          {action === "ARRIVED_COMPLEX" && "Registrar chegada de pedidos à doca"}
                          {action === "DEPARTED_TO_UNIT" && "Registrar saída de pedidos para a farmácia"}
                          {action === "ARRIVED_UNIT" && "Registrar chegada de pedidos à farmácia"}
                          {action === "RECEIVE_COMPLETE" && "Confirmar recebimento completo pela farmácia"}
                        </p>
                      </div>
                      <ArrowRight className="h-5 w-5 opacity-60" />
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── PASSO 3: Leitura de Pedidos ── */}
        {step === "scan_orders" && selectedPoint && selectedAction && (
          <div className="space-y-3">
            {/* Contexto atual */}
            <Card className="bg-white/95">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${STATUS_COLORS[selectedAction]} border`}>
                    {STATUS_LABELS[selectedAction]}
                  </Badge>
                  <span className="text-sm text-gray-500">em</span>
                  <Badge variant="outline">{selectedPoint.name}</Badge>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setStep("select_action")}>
                    <ChevronLeft className="h-3 w-3 mr-1" /> Voltar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Input de pedido */}
            <Card className="bg-white/95">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Passo 3: Bipar Pedidos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">
                  Digite ou bipe o número do pedido. Adicione quantos pedidos precisar antes de confirmar.
                </p>
                <div className="flex gap-2">
                  <Input
                    ref={orderInputRef}
                    value={orderInput}
                    onChange={e => setOrderInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddOrder()}
                    placeholder="Nº do pedido"
                    className="text-lg h-12 font-mono"
                    type="number"
                    autoComplete="off"
                  />
                  <Button onClick={handleAddOrder} className="h-12 px-6" disabled={!orderInput.trim()}>
                    <ScanLine className="h-5 w-5" />
                  </Button>
                </div>

                {/* Lista de pedidos escaneados */}
                {scannedOrders.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {scannedOrders.map(order => (
                      <div key={order.input}
                        className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="font-mono text-sm font-medium">Pedido #{order.id}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                          onClick={() => handleRemoveOrder(order.input)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {scannedOrders.length === 0 && (
                  <div className="flex items-center justify-center h-16 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">
                    Nenhum pedido adicionado ainda
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Botão confirmar */}
            {scannedOrders.length > 0 && (
              <Button
                className="w-full h-14 text-base font-semibold"
                onClick={() => setStep("confirm")}
              >
                Confirmar {scannedOrders.length} pedido{scannedOrders.length > 1 ? "s" : ""}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            )}
          </div>
        )}

        {/* ── PASSO 4: Confirmação ── */}
        {step === "confirm" && selectedPoint && selectedAction && (
          <div className="space-y-3">
            <Card className="bg-white/95">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Confirmar Registro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Ponto:</span>
                    <span className="font-medium">{selectedPoint.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Ação:</span>
                    <Badge className={`${STATUS_COLORS[selectedAction]} border text-xs`}>
                      {STATUS_LABELS[selectedAction]}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Pedidos:</span>
                    <span className="font-bold text-blue-600">{scannedOrders.length}</span>
                  </div>
                </div>

                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {scannedOrders.map(o => (
                    <div key={o.input} className="flex items-center gap-2 text-sm bg-blue-50 rounded px-3 py-1.5">
                      <Package className="h-3.5 w-3.5 text-blue-500" />
                      <span className="font-mono">Pedido #{o.id}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("scan_orders")}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
                  </Button>
                  <Button
                    className="flex-1 h-12 font-semibold"
                    onClick={handleConfirm}
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Registrando...</>
                      : <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── PASSO 5: Resultado ── */}
        {step === "done" && batchResult && (
          <div className="space-y-3">
            {/* Resumo */}
            <Card className={`${batchResult.errorCount === 0 ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  {batchResult.errorCount === 0
                    ? <CheckCircle2 className="h-8 w-8 text-green-600" />
                    : <AlertTriangle className="h-8 w-8 text-yellow-600" />}
                  <div>
                    <p className="font-bold text-lg">
                      {batchResult.errorCount === 0 ? "Registrado com sucesso!" : "Registrado com alertas"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {batchResult.successCount} sucesso{batchResult.successCount !== 1 ? "s" : ""}
                      {batchResult.errorCount > 0 && `, ${batchResult.errorCount} erro${batchResult.errorCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detalhes por pedido */}
            <Card className="bg-white/95">
              <CardContent className="pt-4 space-y-2 max-h-64 overflow-y-auto">
                {batchResult.results.map(r => (
                  <div key={r.orderId}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                      r.success ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"
                    }`}>
                    {r.success
                      ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      : <X className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium font-mono">Pedido #{r.orderId}</p>
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                      {r.warning && (
                        <p className="text-xs text-yellow-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {r.warning}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Ações */}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-12" onClick={handleNewBatch}>
                <ScanLine className="h-4 w-4 mr-2" /> Novo Lote
              </Button>
              <Button className="h-12" onClick={handleReset}>
                <QrCode className="h-4 w-4 mr-2" /> Novo Ponto
              </Button>
            </div>
          </div>
        )}
      </div>
    </CollectorLayout>
  );
}
