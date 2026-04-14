import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Scope = "receiving" | "picking" | "shipping" | "inventory" | "intraHospital";

const SCOPE_LABELS: Record<Scope, { label: string; description: string }> = {
  receiving: { label: "Recebimento", description: "OTs, itens, conferências cegas, etiquetas" },
  picking: { label: "Separação (Picking)", description: "Pedidos, ondas, alocações, conferências de stage" },
  shipping: { label: "Expedição", description: "Remessas e romaneios" },
  inventory: { label: "Estoque", description: "Posições de estoque e movimentações" },
  intraHospital: { label: "Intra-Hospitalar", description: "Logs de checkpoints de rastreabilidade" },
};

const ALL_SCOPES: Scope[] = ["receiving", "picking", "shipping", "inventory", "intraHospital"];

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: number;
  tenantName?: string;
}

export function CleanupTestDataModal({ open, onClose, tenantId, tenantName }: Props) {
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [result, setResult] = useState<{ total: number; deletedCounts: Record<string, number> } | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setSelectedScopes([]);
      setConfirmText("");
      setStep("select");
      setResult(null);
    }
  }, [open]);

  // Preview query — só executa quando step = "preview"
  // staleTime=0 e gcTime=0 garantem que o resultado não seja cacheado entre aberturas do modal
  const { data: preview, isLoading: previewLoading } = trpc.admin.cleanupPreview.useQuery(
    { tenantId, scopes: selectedScopes.length > 0 ? selectedScopes : ["receiving"] },
    {
      enabled: step === "preview" && selectedScopes.length > 0,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: true,
    }
  );

  const cleanupMutation = trpc.admin.cleanupTestData.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      toast.success(`Limpeza concluída: ${data.total} registros removidos.`);
    },
    onError: (err) => {
      toast.error(`Erro na limpeza: ${err.message}`);
    },
  });

  const utils = trpc.useUtils();

  const toggleScope = (scope: Scope) => {
    setSelectedScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  const toggleAll = () => {
    setSelectedScopes(prev => prev.length === ALL_SCOPES.length ? [] : [...ALL_SCOPES]);
  };

  const handlePreview = async () => {
    if (selectedScopes.length === 0) {
      toast.warning("Selecione ao menos um escopo.");
      return;
    }
    // Invalida o cache antes de ir para o preview para garantir dados frescos
    await utils.admin.cleanupPreview.invalidate();
    setStep("preview");
  };

  const handleConfirm = () => {
    if (confirmText !== "CONFIRMAR") {
      toast.error('Digite exatamente "CONFIRMAR" para prosseguir.');
      return;
    }
    cleanupMutation.mutate({ tenantId, scopes: selectedScopes, confirmText });
  };

  const previewTotal = preview?.total ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-5 w-5" />
            Limpeza de Dados de Teste
          </DialogTitle>
          <DialogDescription>
            {tenantName
              ? `Remove dados de teste do cliente "${tenantName}".`
              : "Remove dados de teste de todos os clientes."}
            {" "}Esta ação é <strong>irreversível</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* ── Passo 1: Seleção de escopos ─────────────────────────────────── */}
        {step === "select" && (
          <div className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                Selecione os módulos cujos dados de teste serão removidos permanentemente.
                Cadastros (produtos, endereços, clientes) <strong>não serão afetados</strong>.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  id="all"
                  checked={selectedScopes.length === ALL_SCOPES.length}
                  onCheckedChange={toggleAll}
                />
                <Label htmlFor="all" className="font-semibold cursor-pointer text-sm">
                  Selecionar todos
                </Label>
              </div>
              <Separator />
              {ALL_SCOPES.map((scope) => (
                <div key={scope} className="flex items-start gap-3 py-1">
                  <Checkbox
                    id={scope}
                    checked={selectedScopes.includes(scope)}
                    onCheckedChange={() => toggleScope(scope)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor={scope} className="font-medium cursor-pointer text-sm">
                      {SCOPE_LABELS[scope].label}
                    </Label>
                    <p className="text-xs text-gray-500">{SCOPE_LABELS[scope].description}</p>
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={handlePreview}
                disabled={selectedScopes.length === 0}
              >
                Ver Resumo →
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Passo 2: Preview + confirmação ──────────────────────────────── */}
        {step === "preview" && (
          <div className="space-y-4">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Calculando registros...</span>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {previewTotal} registros serão removidos permanentemente
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {preview && Object.entries(preview.counts).map(([key, val]) => (
                      val > 0 && (
                        <div key={key} className="flex items-center justify-between text-xs text-red-600 bg-red-100 rounded px-2 py-1">
                          <span className="font-mono">{key}</span>
                          <Badge variant="destructive" className="text-xs h-4 px-1">{val}</Badge>
                        </div>
                      )
                    ))}
                    {previewTotal === 0 && (
                      <p className="col-span-2 text-sm text-gray-500 text-center py-2">
                        Nenhum registro encontrado para os escopos selecionados.
                      </p>
                    )}
                  </div>
                </div>

                {previewTotal > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="confirm" className="text-sm font-medium">
                      Para confirmar, digite <code className="bg-gray-100 px-1 rounded font-bold">CONFIRMAR</code>:
                    </Label>
                    <Input
                      id="confirm"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="CONFIRMAR"
                      className="border-red-200 focus:border-red-400"
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>← Voltar</Button>
              {previewTotal > 0 && (
                <Button
                  variant="destructive"
                  onClick={handleConfirm}
                  disabled={confirmText !== "CONFIRMAR" || cleanupMutation.isPending}
                >
                  {cleanupMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Limpando...</>
                  ) : (
                    <><Trash2 className="h-4 w-4 mr-2" />Executar Limpeza</>
                  )}
                </Button>
              )}
              {previewTotal === 0 && !previewLoading && (
                <Button variant="outline" onClick={onClose}>Fechar</Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── Passo 3: Resultado ──────────────────────────────────────────── */}
        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div>
                <p className="text-lg font-semibold text-gray-900">Limpeza concluída!</p>
                <p className="text-sm text-gray-500">
                  <strong>{result.total}</strong> registros foram removidos com sucesso.
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-gray-50 p-3 space-y-1">
              {Object.entries(result.deletedCounts).map(([key, val]) => (
                val > 0 && (
                  <div key={key} className="flex items-center justify-between text-xs text-gray-600">
                    <span className="font-mono">{key}</span>
                    <Badge variant="secondary" className="text-xs h-4 px-1">{val} removidos</Badge>
                  </div>
                )
              ))}
            </div>

            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
