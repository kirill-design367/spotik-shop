import LoginForm from '@/components/admin/LoginForm';
import { yazykAdminki } from '@/lib/server/yazyk';

export const dynamic = 'force-dynamic';

/**
 * ⚠️ СТРАНИЦА СЕРВЕРНАЯ, А ФОРМА КЛИЕНТСКАЯ, и разделены они
 * из-за языка. Язык хранится за сотрудником, а на входе сотрудника
 * ещё нет — его берёт кука, а куку читает только сервер. Клиентская
 * страница спросить об этом некого.
 */
export default async function AdminLoginPage() {
  return <LoginForm y={await yazykAdminki()} />;
}
