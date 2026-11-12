import { useSearchParams, useNavigate } from 'react-router';
import { CalendarDays, ChartColumn, Clock, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useT } from '@/i18n';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { fetchEmployees } from './api';
import { EmployeesList } from './components/EmployeesList';
import { AttendanceTab, PayrollTab, PermissionsTab, ShiftsTab } from './components/StaffTabs';

type Tab = 'list' | 'shifts' | 'permissions' | 'attendance' | 'payroll';
const TABS: Tab[] = ['list', 'shifts', 'permissions', 'attendance', 'payroll'];

export default function EmployeesPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'list';
  const employees = useQuery(fetchEmployees, []);
  useLiveRefetch(['employees_meta'], employees.refetch);
  const rows = employees.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('employees.title')}
        icon={<Users className="size-6" />}
        actions={<Button icon={<ChartColumn className="size-4" />} onClick={() => navigate('/reports?tab=employees')}>{t('employees.reports')}</Button>}
      />
      <Tabs
        className="mb-5"
        layoutId="emp-tabs"
        value={tab}
        onChange={(k) => {
          params.set('tab', k);
          setParams(params, { replace: true });
        }}
        items={[
          { key: 'list', label: t('employees.list'), icon: <Users className="size-4" /> },
          { key: 'shifts', label: t('employees.shifts'), icon: <CalendarDays className="size-4" /> },
          { key: 'permissions', label: t('employees.permissions'), icon: <ShieldCheck className="size-4" /> },
          { key: 'attendance', label: t('employees.attendance'), icon: <Clock className="size-4" /> },
          { key: 'payroll', label: t('employees.payroll'), icon: <Wallet className="size-4" /> },
        ]}
      />
      {tab === 'list' && <EmployeesList employees={employees} />}
      {tab === 'shifts' && <ShiftsTab employees={rows} />}
      {tab === 'permissions' && <PermissionsTab />}
      {tab === 'attendance' && <AttendanceTab employees={rows} />}
      {tab === 'payroll' && <PayrollTab employees={rows} />}
    </div>
  );
}
