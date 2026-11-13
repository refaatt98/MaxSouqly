import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BookOpen, Boxes, ChartColumn, ClipboardCheck, ShoppingBag, Truck } from 'lucide-react';
import { useT } from '@/i18n';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch, useRealtime } from '@/hooks/useRealtime';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { Tabs } from '@/components/ui/Tabs';
import { fetchIngredients, fetchSuppliers, stockLevel } from './api';
import { MaterialsTab } from './components/MaterialsTab';
import { SuppliersTab } from './components/SuppliersTab';
import { PurchasesTab } from './components/PurchasesTab';
import { StocktakeTab } from './components/StocktakeTab';
import { RecipesTab } from './components/RecipesTab';
import { InventoryReportsTab } from './components/InventoryReportsTab';

type Tab = 'materials' | 'suppliers' | 'purchases' | 'stocktake' | 'recipes' | 'reports';
const TABS: Tab[] = ['materials', 'suppliers', 'purchases', 'stocktake', 'recipes', 'reports'];

export default function InventoryPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const { role } = useAuth();
  // cashiers only count stock; the rest of inventory is for the back office
  const tabs: Tab[] = role === 'cashier' ? ['stocktake'] : TABS;
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && tabs.includes(tabParam) ? tabParam : tabs[0];
  const ingredients = useQuery(fetchIngredients, []);
  const suppliers = useQuery(fetchSuppliers, []);
  const [newPo, setNewPo] = useState(false);

  // live stock levels (sales on the POS deduct stock in real time)
  useRealtime({ table: 'ingredients' }, (p) => {
    if (p.eventType === 'UPDATE') ingredients.setData((list = []) => list.map((i) => (i.id === p.new.id ? p.new : i)));
    else void ingredients.refetch();
  });

  useLiveRefetch(['suppliers'], suppliers.refetch);

  const setTab = useCallback(
    (next: Tab) => {
      params.set('tab', next);
      params.delete('low');
      setParams(params, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    document.title = `${t('inventory.title')} — MAX`;
  }, [t]);

  const lowCount = (ingredients.data ?? []).filter((i) => i.is_active && stockLevel(i) !== 'ok').length;

  return (
    <div>
      <PageHeader title={t('inventory.title')} icon={<Boxes className="size-6" />} subtitle={lowCount > 0 ? t('inventory.lowCount', { count: lowCount }) : undefined} />
      <Tabs
        className="mb-5"
        layoutId="inv-tabs"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'materials' as Tab, label: t('inventory.materials'), icon: <Boxes className="size-4" />, count: lowCount },
          { key: 'suppliers' as Tab, label: t('inventory.suppliers'), icon: <Truck className="size-4" /> },
          { key: 'purchases' as Tab, label: t('inventory.purchases'), icon: <ShoppingBag className="size-4" /> },
          { key: 'stocktake' as Tab, label: t('inventory.stocktake'), icon: <ClipboardCheck className="size-4" /> },
          { key: 'recipes' as Tab, label: t('inventory.recipes'), icon: <BookOpen className="size-4" /> },
          { key: 'reports' as Tab, label: t('inventory.reports'), icon: <ChartColumn className="size-4" /> },
        ].filter((x) => tabs.includes(x.key as Tab))}
      />
      {tab === 'materials' && (
        <MaterialsTab
          ingredients={ingredients}
          suppliers={suppliers.data ?? []}
          lowOnly={params.get('low') === '1'}
          onNewPurchase={() => {
            setNewPo(true);
            setTab('purchases');
          }}
        />
      )}
      {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} ingredients={ingredients.data ?? []} />}
      {tab === 'purchases' && (
        <PurchasesTab
          suppliers={suppliers.data ?? []}
          ingredients={ingredients.data ?? []}
          newRequest={newPo}
          onNewHandled={() => setNewPo(false)}
          onChanged={() => void ingredients.refetch()}
        />
      )}
      {tab === 'stocktake' && <StocktakeTab ingredients={ingredients.data ?? []} onChanged={() => void ingredients.refetch()} />}
      {tab === 'recipes' && <RecipesTab ingredients={ingredients.data ?? []} />}
      {tab === 'reports' && <InventoryReportsTab />}
    </div>
  );
}
