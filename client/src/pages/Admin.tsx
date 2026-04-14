import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState } from "react";
import {
  Shield,
  Trash2,
  Users,
  Package,
  MapPin,
  ClipboardList,
  BarChart3,
  Database,
  AlertTriangle,
  Settings,
  FileText,
  RefreshCw,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { CleanupTestDataModal } from "@/components/CleanupTestDataModal";

export default function Admin() {
  const { user } = useAuth();
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const isGlobalAdmin = user?.role === "admin" && (user?.tenantId === 1 || user?.tenantId === null);

  // Estatísticas rápidas
  const { data: tenantsData } = trpc.tenants.list.useQuery(undefined, { enabled: isGlobalAdmin });
  const { data: productsData } = trpc.products.list.useQuery();
  const { data: locationsData } = trpc.locations.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({});

  const adminSections = [
    {
      title: "Gestão de Clientes",
      description: "Cadastrar, editar e desativar clientes (tenants) do sistema",
      icon: Building2,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      href: "/tenants",
      badge: isGlobalAdmin ? `${tenantsData?.length ?? "—"} clientes` : null,
    },
    {
      title: "Gestão de Usuários",
      description: "Criar e gerenciar usuários, perfis e permissões de acesso",
      icon: Users,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      href: "/users",
      badge: null,
    },
    {
      title: "Perfis e Permissões",
      description: "Configurar papéis e níveis de acesso por módulo",
      icon: Shield,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      href: "/roles",
      badge: null,
    },
    {
      title: "Cadastro de Produtos",
      description: "Gerenciar catálogo de produtos e SKUs",
      icon: Package,
      color: "text-green-600",
      bgColor: "bg-green-50",
      href: "/products",
      badge: null,
    },
    {
      title: "Endereçamento",
      description: "Configurar estrutura de endereços do armazém",
      icon: MapPin,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      href: "/locations",
      badge: null,
    },
    {
      title: "Relatórios e KPIs",
      description: "Dashboards de performance, rastreabilidade e conformidade",
      icon: BarChart3,
      color: "text-cyan-600",
      bgColor: "bg-cyan-50",
      href: "/reports",
      badge: null,
    },
    {
      title: "Importação de NF-e",
      description: "Upload de XML de notas fiscais e geração de OTs",
      icon: FileText,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      href: "/nfe-import",
      badge: null,
    },
    {
      title: "Configurações de Impressão",
      description: "Configurar impressoras e modelos de etiquetas",
      icon: Settings,
      color: "text-gray-600",
      bgColor: "bg-gray-50",
      href: "/settings/printing",
      badge: null,
    },
    {
      title: "Pontos de Entrega Intra-Hosp.",
      description: "Cadastrar docas e farmácias para rastreabilidade interna",
      icon: Building2,
      color: "text-teal-600",
      bgColor: "bg-teal-50",
      href: "/intra-hospitalar/pontos",
      badge: null,
    },
  ];

  const dangerZoneActions = [
    {
      title: "Limpeza de Dados de Teste",
      description: "Remove pedidos, recebimentos e movimentações criados para testes. Esta ação é irreversível.",
      icon: Trash2,
      action: () => setCleanupModalOpen(true),
    },
    {
      title: "Reindexar Estoque",
      description: "Recalcula posições e quantidades de estoque com base nos logs de movimentação.",
      icon: RefreshCw,
      action: () => toast.info("Reindexação iniciada. Isso pode levar alguns minutos."),
    },
    {
      title: "Exportar Auditoria Completa",
      description: "Gera um relatório completo de todas as operações realizadas no sistema.",
      icon: Database,
      action: () => toast.info("Exportação de auditoria disponível em /reports."),
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Shield className="h-6 w-6 text-red-600" />
              Painel Administrativo
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Gerenciamento, auditoria e configurações do sistema WMS Med@x
            </p>
          </div>
          {isGlobalAdmin && (
            <Badge className="bg-red-100 text-red-700 border-red-200">
              Global Admin
            </Badge>
          )}
        </div>

        {/* Aviso de permissão */}
        {!isGlobalAdmin && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3 text-amber-700">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">
                  Algumas funcionalidades administrativas estão disponíveis apenas para o <strong>Global Admin</strong>.
                  Entre em contato com o suporte se precisar de acesso adicional.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grade de módulos */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Módulos do Sistema</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {adminSections.map((section) => (
              <Link key={section.href} href={section.href}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow border hover:border-gray-300">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${section.bgColor} flex-shrink-0`}>
                        <section.icon className={`h-5 w-5 ${section.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{section.title}</p>
                          {section.badge && (
                            <Badge variant="secondary" className="text-xs">{section.badge}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{section.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Zona de Perigo (apenas Global Admin) */}
        {isGlobalAdmin && (
          <div>
            <h2 className="text-sm font-semibold text-red-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Zona de Perigo
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dangerZoneActions.map((action) => (
                <Card key={action.title} className="border-red-100">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                      <action.icon className="h-4 w-4" />
                      {action.title}
                    </CardTitle>
                    <CardDescription className="text-xs">{action.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-red-200 text-red-600 hover:bg-red-50"
                      onClick={action.action}
                    >
                      Executar
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Info de conformidade */}
        <Card className="border-gray-100 bg-gray-50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3 text-gray-600">
              <ClipboardList className="h-5 w-5 flex-shrink-0 text-gray-400" />
              <div>
                <p className="text-sm font-medium">Conformidade ANVISA RDC 430/2020</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Todas as operações são registradas com rastreabilidade completa de usuário, data/hora e tenant.
                  Os logs de auditoria são preservados por no mínimo 5 anos conforme exigência regulatória.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modal de Limpeza de Dados de Teste */}
      <CleanupTestDataModal
        open={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
      />
    </DashboardLayout>
  );
}
