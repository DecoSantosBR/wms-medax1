import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "sonner";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, QrCode, Building2, Package, RefreshCw, AlertCircle } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

// ── QR Code Canvas ────────────────────────────────────────────────────────────

function QRCodeDisplay({ value, size = 128 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && value) {
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 }, (err) => {
        if (err) console.error("QR Code error:", err);
      });
    }
  }, [value, size]);

  return <canvas ref={canvasRef} />;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type DeliveryPoint = {
  id: number;
  name: string;
  type: "DOCK" | "PHARMACY";
  externalCode: string;
  description: string | null;
  active: boolean;
};

type FormData = {
  name: string;
  type: "DOCK" | "PHARMACY";
  externalCode: string;
  description: string;
  active: boolean;
};

const emptyForm: FormData = {
  name: "",
  type: "DOCK",
  externalCode: "",
  description: "",
  active: true,
};

// ── Componente Principal ──────────────────────────────────────────────────────

export default function DeliveryPoints() {
  const utils = trpc.useUtils();
  const { user } = useAuth();

  const isGlobalAdmin = user?.role === "admin" && (user?.tenantId === 1 || user?.tenantId === null);

  const [filterType, setFilterType] = useState<"ALL" | "DOCK" | "PHARMACY">("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrPoint, setQrPoint] = useState<DeliveryPoint | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(undefined);

  // Buscar lista de tenants para o Tenant Selector (Global Admin)
  const { data: tenantsList } = trpc.tenants.list.useQuery(undefined, {
    enabled: isGlobalAdmin,
  });

  const { data, isLoading, refetch } = trpc.intraHospital.listDeliveryPoints.useQuery({
    type: filterType === "ALL" ? undefined : filterType,
    activeOnly: !showInactive,
    tenantId: isGlobalAdmin ? selectedTenantId : undefined,
  }, {
    enabled: !isGlobalAdmin || selectedTenantId !== undefined,
  });

  const createMut = trpc.intraHospital.createDeliveryPoint.useMutation({
    onSuccess: () => {
      toast.success("Ponto de entrega criado com sucesso!");
      utils.intraHospital.listDeliveryPoints.invalidate();
      setFormOpen(false);
      setFormData(emptyForm);
    },
    onError: (e) => toast.error(`Erro ao criar: ${e.message}`),
  });

  const updateMut = trpc.intraHospital.updateDeliveryPoint.useMutation({
    onSuccess: () => {
      toast.success("Ponto de entrega atualizado!");
      utils.intraHospital.listDeliveryPoints.invalidate();
      setFormOpen(false);
      setEditingId(null);
      setFormData(emptyForm);
    },
    onError: (e) => toast.error(`Erro ao atualizar: ${e.message}`),
  });

  const deleteMut = trpc.intraHospital.deleteDeliveryPoint.useMutation({
    onSuccess: () => {
      toast.success("Ponto de entrega desativado.");
      utils.intraHospital.listDeliveryPoints.invalidate();
      setDeleteConfirmId(null);
    },
    onError: (e) => toast.error(`Erro ao desativar: ${e.message}`),
  });

  function openCreate() {
    setEditingId(null);
    setFormData(emptyForm);
    setFormOpen(true);
  }

  function openEdit(point: DeliveryPoint) {
    setEditingId(point.id);
    setFormData({
      name: point.name,
      type: point.type,
      externalCode: point.externalCode,
      description: point.description ?? "",
      active: point.active,
    });
    setFormOpen(true);
  }

  function handleSubmit() {
    if (!formData.name.trim() || !formData.externalCode.trim()) {
      toast.error("Preencha nome e código externo");
      return;
    }
    if (isGlobalAdmin && !selectedTenantId) {
      toast.error("Selecione um cliente antes de criar um ponto de entrega");
      return;
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, ...formData, tenantId: isGlobalAdmin ? selectedTenantId : undefined });
    } else {
      createMut.mutate({ ...formData, tenantId: isGlobalAdmin ? selectedTenantId : undefined });
    }
  }

  const points = data ?? [];
  const dockCount = points.filter(p => p.type === "DOCK").length;
  const pharmacyCount = points.filter(p => p.type === "PHARMACY").length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="h-6 w-6 text-blue-600" />
              Pontos de Entrega Intra-Hospitalar
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Cadastre docas e farmácias para rastreabilidade interna
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2" disabled={isGlobalAdmin && !selectedTenantId}>
            <Plus className="h-4 w-4" /> Novo Ponto
          </Button>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Package className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{dockCount}</p>
                  <p className="text-xs text-gray-500">Docas de Descarregamento</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Building2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pharmacyCount}</p>
                  <p className="text-xs text-gray-500">Farmácias Internas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <QrCode className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{points.length}</p>
                  <p className="text-xs text-gray-500">Total de Pontos Ativos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex gap-2">
                {(["ALL", "DOCK", "PHARMACY"] as const).map(t => (
                  <Button
                    key={t}
                    variant={filterType === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterType(t)}
                  >
                    {t === "ALL" ? "Todos" : t === "DOCK" ? "Docas" : "Farmácias"}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} id="show-inactive" />
                <Label htmlFor="show-inactive" className="text-sm text-gray-600">Mostrar inativos</Label>
                <Button variant="ghost" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabela */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">Carregando...</div>
            ) : points.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
                <Building2 className="h-8 w-8" />
                <p>Nenhum ponto de entrega cadastrado</p>
                <Button variant="outline" size="sm" onClick={openCreate}>Cadastrar primeiro ponto</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Código Externo (QR)</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((point) => (
                    <TableRow key={point.id} className={!point.active ? "opacity-50" : ""}>
                      <TableCell className="font-medium">{point.name}</TableCell>
                      <TableCell>
                        <Badge variant={point.type === "DOCK" ? "secondary" : "default"}
                          className={point.type === "DOCK" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}>
                          {point.type === "DOCK" ? "🚚 Doca" : "🏥 Farmácia"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{point.externalCode}</code>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-xs truncate">{point.description ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={point.active ? "default" : "secondary"}
                          className={point.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>
                          {point.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => { setQrPoint(point as DeliveryPoint); setQrOpen(true); }}>
                            <QrCode className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(point as DeliveryPoint)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {point.active && (
                            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                              onClick={() => setDeleteConfirmId(point.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal de Criação/Edição */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Ponto de Entrega" : "Novo Ponto de Entrega"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Campo Cliente */}
            <div>
              <Label>Cliente *</Label>
              {isGlobalAdmin ? (
                // Global Admin: pode selecionar qualquer tenant com Intra-Hospitalar ativo
                <Select
                  value={selectedTenantId?.toString() ?? ""}
                  onValueChange={(v) => setSelectedTenantId(v ? Number(v) : undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(tenantsList ?? []).filter(t => t.hasIntraHospitalar).map(t => (
                      <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                // Tenant normal: Select com apenas o seu próprio tenant (bloqueado)
                <Select value={user?.tenantId?.toString() ?? ""} disabled>
                  <SelectTrigger className="bg-gray-50">
                    <SelectValue placeholder="Carregando...">
                      {user?.name ?? user?.email ?? `Tenant ${user?.tenantId}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {user?.tenantId && (
                      <SelectItem value={user.tenantId.toString()}>
                        {user.name ?? user.email ?? `Tenant ${user.tenantId}`}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {isGlobalAdmin && !selectedTenantId && (
                <p className="text-xs text-amber-600 mt-1">Selecione o cliente para associar este ponto de entrega.</p>
              )}
            </div>
            <div>
              <Label>Nome *</Label>
              <Input
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Doca A, Farmácia Central"
              />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={formData.type} onValueChange={v => setFormData(f => ({ ...f, type: v as "DOCK" | "PHARMACY" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DOCK">🚚 Doca de Descarregamento</SelectItem>
                  <SelectItem value="PHARMACY">🏥 Farmácia Interna</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Código Externo (para QR Code) *</Label>
              <Input
                value={formData.externalCode}
                onChange={e => setFormData(f => ({ ...f, externalCode: e.target.value.toUpperCase() }))}
                placeholder="Ex: DOCA-A, FARM-CENTRAL"
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Código único que será codificado no QR Code</p>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                value={formData.description}
                onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                placeholder="Descrição opcional do ponto de entrega"
                rows={2}
              />
            </div>
            {editingId && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.active}
                  onCheckedChange={v => setFormData(f => ({ ...f, active: v }))}
                  id="form-active"
                />
                <Label htmlFor="form-active">Ativo</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editingId ? "Salvar Alterações" : "Criar Ponto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de QR Code */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              QR Code — {qrPoint?.name}
            </DialogTitle>
          </DialogHeader>
          {qrPoint && (
            <div className="flex flex-col items-center gap-4 py-4">
              <QRCodeDisplay value={qrPoint.externalCode} size={200} />
              <div className="text-center">
                <p className="text-sm text-gray-500">Código:</p>
                <code className="text-lg font-bold font-mono">{qrPoint.externalCode}</code>
              </div>
              <Badge variant="secondary" className={qrPoint.type === "DOCK" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}>
                {qrPoint.type === "DOCK" ? "🚚 Doca" : "🏥 Farmácia"}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => {
                const canvas = document.querySelector("canvas");
                if (canvas) {
                  const link = document.createElement("a");
                  link.download = `qr-${qrPoint.externalCode}.png`;
                  link.href = canvas.toDataURL();
                  link.click();
                }
              }}>
                Baixar QR Code
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desativar Ponto de Entrega?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">O ponto será desativado e não aparecerá mais para os coletores. O histórico de checkpoints é preservado.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteMut.mutate({ id: deleteConfirmId })}
              disabled={deleteMut.isPending}>
              Desativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
