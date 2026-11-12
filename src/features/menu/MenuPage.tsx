import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Pencil, Plus, Search, Trash, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { deleteImage } from '@/lib/r2';
import { hasErrors, v, type Errors } from '@/lib/validation';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useConfirm } from '@/app/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput, Textarea } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { FoodImage } from '@/components/ui/FoodImage';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { CATEGORY_ICONS, CategoryIcon } from '@/components/ui/CategoryIcon';
import { ImageUploader, useImageField } from '@/components/ui/ImageUploader';
import type { Category, MenuItem } from '@/types/models';

async function fetchMenu() {
  const [cats, items] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order').order('name_ar'),
    supabase.from('menu_items').select('*').order('sort_order').order('name_ar'),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;
  return { categories: cats.data, items: items.data };
}

type ItemField = 'name_ar' | 'name_he' | 'price' | 'category_id' | 'description' | 'barcode' | 'sort_order';

function ItemModal({ item, categories, defaultCategory, onClose, onSaved }: {
  item: MenuItem | 'new' | null;
  categories: Category[];
  defaultCategory: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { f } = useSettings();
  const toast = useToast();
  const editing = item !== null && item !== 'new' ? item : null;
  const image = useImageField(editing?.image_url ?? null);
  const [form, setForm] = useState<Record<ItemField, string>>({ name_ar: '', name_he: '', price: '', category_id: '', description: '', barcode: '', sort_order: '0' });
  const [available, setAvailable] = useState(true);
  const [errors, setErrors] = useState<Errors<ItemField>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (item === null) return;
    setForm({
      name_ar: editing?.name_ar ?? '',
      name_he: editing?.name_he ?? '',
      price: editing ? String(editing.price) : '',
      category_id: editing?.category_id ?? defaultCategory ?? categories[0]?.id ?? '',
      description: editing?.description ?? '',
      barcode: editing?.barcode ?? '',
      sort_order: String(editing?.sort_order ?? 0),
    });
    setAvailable(editing?.is_available ?? true);
    setErrors({});
    image.reset(editing?.image_url ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const set = (k: ItemField, value: string) => setForm((s) => ({ ...s, [k]: value }));

  const save = async () => {
    const e: Errors<ItemField> = {
      name_ar: v.required(t, form.name_ar) ?? v.maxLen(t, form.name_ar, 80),
      name_he: v.maxLen(t, form.name_he, 80),
      price: v.number(t, form.price, { min: 0, max: 100000 }),
      category_id: v.required(t, form.category_id),
      description: v.maxLen(t, form.description, 300),
      sort_order: v.number(t, form.sort_order, { integer: true, min: 0, max: 9999 }),
    };
    setErrors(e);
    if (hasErrors(e)) return;
    setPending(true);
    const row = {
      name_ar: form.name_ar.trim(),
      name_he: form.name_he.trim(),
      price: Number(form.price),
      category_id: form.category_id,
      description: form.description.trim(),
      barcode: form.barcode.trim() || null,
      sort_order: Number(form.sort_order),
      is_available: available,
      image_url: image.url,
    };
    const { error } = editing ? await supabase.from('menu_items').update(row).eq('id', editing.id) : await supabase.from('menu_items').insert(row);
    setPending(false);
    if (error) {
      toast.error(errorMessage(t, error));
      return;
    }
    await image.commit();
    toast.success(t('common.saved'));
    onSaved();
  };

  const cancel = () => {
    void image.discard();
    onClose();
  };

  const margin = editing && Number(form.price) > 0 ? ((Number(form.price) - Number(editing.cost_cache)) / Number(form.price)) * 100 : null;

  return (
    <Modal
      open={item !== null}
      onClose={cancel}
      title={editing ? t('menu.editItem') : t('menu.newItem')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label={t('common.nameAr')} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} error={errors.name_ar} required data-autofocus />
        <TextInput label={t('common.nameHe')} value={form.name_he} onChange={(e) => set('name_he', e.target.value)} error={errors.name_he} lang="he" />
        <Select label={t('menu.category')} value={form.category_id} onChange={(e) => set('category_id', e.target.value)} error={errors.category_id} options={categories.map((c) => ({ value: c.id, label: c.name_ar }))} required />
        <TextInput label={t('common.price')} type="number" inputMode="decimal" min={0} step="0.5" value={form.price} onChange={(e) => set('price', e.target.value)} error={errors.price} suffix="₪" required />
        <TextInput label={t('menu.barcode')} value={form.barcode} onChange={(e) => set('barcode', e.target.value)} dir="ltr" />
        <TextInput label={t('menu.sortOrder')} type="number" inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} error={errors.sort_order} />
        <Textarea className="md:col-span-2" label={t('menu.description')} value={form.description} onChange={(e) => set('description', e.target.value)} error={errors.description} rows={2} />
        <ImageUploader className="md:col-span-2" label={t('menu.image')} value={image.url} onChange={image.setUrl} folder="menu" />
        <div className="md:col-span-2">
          <Toggle id="item-available" label={t('menu.available')} checked={available} onChange={setAvailable} />
          {editing && (
            <p className="text-sm text-fg-3">
              {t('menu.costFromRecipe')}: <span className="num text-fg">{f.money(Number(editing.cost_cache))}</span>
              {margin !== null && <> · {t('menu.margin')}: <span className={cn('num font-semibold', margin < 50 ? 'text-warning' : 'text-success')}>{f.percent(margin)}</span></>}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CategoryModal({ category, onClose, onSaved }: { category: Category | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const editing = category !== null && category !== 'new' ? category : null;
  const [nameAr, setNameAr] = useState('');
  const [nameHe, setNameHe] = useState('');
  const [icon, setIcon] = useState('burger');
  const [sort, setSort] = useState('0');
  const [active, setActive] = useState(true);
  const image = useImageField(editing?.image_url ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (category === null) return;
    setNameAr(editing?.name_ar ?? '');
    setNameHe(editing?.name_he ?? '');
    setIcon(editing?.icon ?? 'burger');
    setSort(String(editing?.sort_order ?? 0));
    setActive(editing?.is_active ?? true);
    image.reset(editing?.image_url ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const save = async () => {
    const err = v.required(t, nameAr) ?? v.maxLen(t, nameAr, 60);
    setError(err);
    if (err) return;
    setPending(true);
    const row = { name_ar: nameAr.trim(), name_he: nameHe.trim(), icon, sort_order: Number(sort) || 0, is_active: active, image_url: image.url };
    const { error: e } = editing ? await supabase.from('categories').update(row).eq('id', editing.id) : await supabase.from('categories').insert(row);
    setPending(false);
    if (e) return toast.error(errorMessage(t, e));
    await image.commit();
    toast.success(t('common.saved'));
    onSaved();
  };
  const cancel = () => {
    void image.discard();
    onClose();
  };

  return (
    <Modal
      open={category !== null}
      onClose={cancel}
      title={editing ? t('menu.editCategory') : t('menu.newCategory')}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={pending} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ImageUploader label={t('menu.categoryImage')} value={image.url} onChange={image.setUrl} folder="categories" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t('common.nameAr')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} error={error} required data-autofocus />
          <TextInput label={t('common.nameHe')} value={nameHe} onChange={(e) => setNameHe(e.target.value)} lang="he" />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg-2">{t('menu.icon')}</p>
          <div className="grid grid-cols-6 gap-2">
            {Object.keys(CATEGORY_ICONS).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setIcon(k)}
                aria-pressed={icon === k}
                aria-label={k}
                className={cn('grid h-12 place-items-center rounded-btn border transition-colors', icon === k ? 'border-line-strong bg-elevated text-fg shadow-glow-sm' : 'border-line bg-card text-fg-3 hover:border-line-strong')}
              >
                <CategoryIcon icon={k} className="size-5" />
              </button>
            ))}
          </div>
        </div>
        <TextInput label={t('menu.sortOrder')} type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
        <Toggle id="cat-active" label={t('common.active')} checked={active} onChange={setActive} />
      </div>
    </Modal>
  );
}

export default function MenuPage() {
  const t = useT();
  const { f, name } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const menu = useQuery(fetchMenu, []);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<MenuItem | 'new' | null>(null);
  const [editCat, setEditCat] = useState<Category | 'new' | null>(null);

  useLiveRefetch(['menu_items', 'categories', 'recipe_items'], menu.refetch);

  useEffect(() => {
    const id = params.get('edit');
    if (id && menu.data) {
      const item = menu.data.items.find((i) => i.id === id);
      if (item) setEditItem(item);
      params.delete('edit');
      setParams(params, { replace: true });
    }
  }, [params, menu.data, setParams]);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (menu.data?.items ?? []).filter(
      (i) => (category === null || i.category_id === category) && (!needle || i.name_ar.toLowerCase().includes(needle) || i.name_he.toLowerCase().includes(needle)),
    );
  }, [menu.data, category, search]);

  const toggleAvailable = async (item: MenuItem) => {
    menu.setData((d) => ({ categories: d?.categories ?? [], items: (d?.items ?? []).map((i) => (i.id === item.id ? { ...i, is_available: !i.is_available } : i)) }));
    const { error } = await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id);
    if (error) {
      toast.error(errorMessage(t, error));
      void menu.refetch();
    }
  };

  const removeItem = async (item: MenuItem) => {
    if (!(await confirm({ title: t('common.delete'), body: t('menu.deleteItemConfirm', { name: item.name_ar }), danger: true, confirmLabel: t('common.delete') }))) return;
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) return toast.error(errorMessage(t, error));
    void deleteImage(item.image_url);
    toast.success(t('common.deleted'));
    void menu.refetch();
  };

  const removeCategory = async (c: Category) => {
    if (!(await confirm({ title: t('common.delete'), body: t('menu.deleteCategoryConfirm', { name: c.name_ar }), danger: true, confirmLabel: t('common.delete') }))) return;
    const { error } = await supabase.from('categories').delete().eq('id', c.id);
    if (error) return toast.error(errorMessage(t, error));
    if (category === c.id) setCategory(null);
    toast.success(t('common.deleted'));
    void menu.refetch();
  };

  return (
    <div>
      <PageHeader
        title={t('menu.title')}
        icon={<UtensilsCrossed className="size-6" />}
        actions={
          <>
            <Button onClick={() => setEditCat('new')}>{t('menu.addCategory')}</Button>
            <Button variant="primary" onClick={() => setEditItem('new')}>{t('menu.addItem')}</Button>
          </>
        }
      />
      {menu.error && !menu.data ? (
        <ErrorState message={errorMessage(t, menu.error)} onRetry={() => void menu.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-2">
            <p className="px-3 py-2 text-xs font-semibold text-fg-3">{t('menu.categories')}</p>
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={cn('flex h-10 w-full items-center gap-2.5 rounded-btn px-3 text-sm transition-colors', category === null ? 'bg-elevated text-fg shadow-glow-sm' : 'text-fg-2 hover:bg-black/[0.04]')}
            >
              <UtensilsCrossed className="size-4" /> {t('common.all')}
              <span className="mono ms-auto text-xs text-fg-3">{menu.data?.items.length ?? 0}</span>
            </button>
            {(menu.data?.categories ?? []).map((c) => (
              <div key={c.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-btn px-3 text-sm transition-colors',
                    category === c.id ? 'bg-elevated text-fg shadow-glow-sm' : 'text-fg-2 hover:bg-black/[0.04]',
                    !c.is_active && 'opacity-50',
                  )}
                >
                  {c.image_url ? <img src={c.image_url} alt="" className="size-6 rounded object-cover" /> : <CategoryIcon icon={c.icon} className="size-4" />}
                  <span className="truncate">{name(c)}</span>
                  <span className="mono ms-auto text-xs text-fg-3">{menu.data?.items.filter((i) => i.category_id === c.id).length}</span>
                </button>
                <IconButton label={t('common.edit')} size="sm" onClick={() => setEditCat(c)}><Pencil className="size-3.5" /></IconButton>
                <IconButton label={t('common.delete')} size="sm" onClick={() => void removeCategory(c)} className="hover:text-danger"><Trash className="size-3.5" /></IconButton>
              </div>
            ))}
          </Card>
          <div>
            <TextInput icon={<Search className="size-4" />} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4" aria-label={t('common.search')} />
            {menu.loading && !menu.data ? (
              <SkeletonGrid count={8} />
            ) : items.length === 0 ? (
              <EmptyState icon={<UtensilsCrossed className="size-7" />} title={t('menu.empty')} action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditItem('new')}>{t('menu.addItem')}</Button>} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {items.map((i) => {
                  const margin = Number(i.price) > 0 ? ((Number(i.price) - Number(i.cost_cache)) / Number(i.price)) * 100 : 0;
                  return (
                    <Card key={i.id} className={cn('flex flex-col p-3', !i.is_available && 'opacity-60')}>
                      <button type="button" onClick={() => setEditItem(i)} className="text-start">
                        <FoodImage src={i.image_url} alt="" className="aspect-[4/3] w-full rounded-btn" />
                        <p className="mt-2 truncate text-fg">{name(i)}</p>
                      </button>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="num text-[17px] font-medium text-fg">{f.money(Number(i.price))}</span>
                        <span className={cn('num text-xs', margin >= 40 ? 'text-fg-3' : 'text-danger')}>{t('menu.margin')} {f.percent(margin)}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                        <Toggle checked={i.is_available} onChange={() => void toggleAvailable(i)} />
                        <div className="flex">
                          <IconButton label={t('common.edit')} size="sm" onClick={() => setEditItem(i)}><Pencil className="size-4" /></IconButton>
                          <IconButton label={t('common.delete')} size="sm" onClick={() => void removeItem(i)} className="hover:text-danger"><Trash className="size-4" /></IconButton>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      <ItemModal
        item={editItem}
        categories={menu.data?.categories ?? []}
        defaultCategory={category}
        onClose={() => setEditItem(null)}
        onSaved={() => {
          setEditItem(null);
          void menu.refetch();
        }}
      />
      <CategoryModal
        category={editCat}
        onClose={() => setEditCat(null)}
        onSaved={() => {
          setEditCat(null);
          void menu.refetch();
        }}
      />
    </div>
  );
}
