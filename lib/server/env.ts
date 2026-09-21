/**
 * Окружение сервера.
 *
 * ⚠️ СЕКРЕТОВ В РЕПОЗИТОРИИ НЕТ И БЫТЬ НЕ ДОЛЖНО. Пароль базы
 * и ключ шифрования генерируются НА СЕРВЕРЕ при первичной настройке
 * и лежат там же, в файле `/srv/spotik/env` с правами 600, который
 * systemd подсовывает приложению через `EnvironmentFile`. В git
 * не уезжает ни одна из этих величин — прямое требование постановки.
 *
 * ⚠️ ЧТЕНИЕ ЛЕНИВОЕ, А НЕ НА ИМПОРТЕ. Лендинг обязан собираться
 * и работать БЕЗ базы, почты и Робокассы: на раннере ничего этого
 * нет, а сборка обязана проходить. Поэтому здесь нет ни одной
 * проверки «упасть, если не задано», — каждый узел сам решает, что
 * делать без своей настройки, и все они умеют не работать тихо.
 */

function str(imya: string, po_umolchaniyu = ''): string {
  const v = process.env[imya];
  return typeof v === 'string' && v.trim() ? v.trim() : po_umolchaniyu;
}

function flag(imya: string, po_umolchaniyu = false): boolean {
  const v = str(imya);
  if (!v) return po_umolchaniyu;
  return ['1', 'true', 'yes', 'da', 'on'].includes(v.toLowerCase());
}

function chislo(imya: string, po_umolchaniyu: number): number {
  const v = Number(str(imya));
  return Number.isFinite(v) ? v : po_umolchaniyu;
}

export const env = {
  /** Строка подключения к PostgreSQL. Пусто — базы нет, сайт живёт лендингом. */
  get databaseUrl() {
    return str('DATABASE_URL');
  },
  /** Ключ шифрования доступов, base64 от 32 байт. */
  get cryptoKey() {
    return str('SPOTIK_CRYPTO_KEY');
  },
  /** Боевой адрес сайта: нужен для ссылок в письмах и возвратов Робокассы. */
  get siteUrl() {
    return str('SPOTIK_SITE_URL', 'https://spotik.shop').replace(/\/+$/, '');
  },
  /**
   * Первые администраторы: список адресов через запятую.
   *
   * Заводятся при первом обращении к таблице сотрудников. Снять
   * администратора, убрав его отсюда, нельзя — это делается в самой
   * админке: иначе перезапуск сервиса возвращал бы уволенного.
   */
  get firstAdmins(): string[] {
    return str('SPOTIK_ADMINS')
      .split(/[,\s;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'));
  },

  /* ── Почта ─────────────────────────────────────────────────── */
  get smtpHost() {
    return str('SMTP_HOST');
  },
  get smtpPort() {
    return chislo('SMTP_PORT', 587);
  },
  get smtpUser() {
    return str('SMTP_USER');
  },
  get smtpPass() {
    return str('SMTP_PASS');
  },
  get smtpFrom() {
    return str('SMTP_FROM', 'Spotik Shop <no-reply@spotik.shop>');
  },
  get smtpSecure() {
    return flag('SMTP_SECURE', false);
  },

  /* ── Робокасса ─────────────────────────────────────────────── */
  get rkLogin() {
    return str('ROBOKASSA_LOGIN');
  },
  get rkPass1() {
    return str('ROBOKASSA_PASS1');
  },
  get rkPass2() {
    return str('ROBOKASSA_PASS2');
  },
  get rkTestPass1() {
    return str('ROBOKASSA_TEST_PASS1');
  },
  get rkTestPass2() {
    return str('ROBOKASSA_TEST_PASS2');
  },
  /**
   * ⚠️ ОДНА НАСТРОЙКА ПЕРЕКЛЮЧАЕТ ВСЁ: и флажок `IsTest`, и ПАРУ
   * ПАРОЛЕЙ. Боевые пароли в тестовом режиме дают ошибку 29
   * («неверная подпись»), неотличимую на глаз от ошибки в формуле.
   */
  get rkTest() {
    return flag('ROBOKASSA_TEST', true);
  },
  get rkAlgo() {
    return str('ROBOKASSA_ALGO', 'md5');
  },
  get rkAlgoResult() {
    return str('ROBOKASSA_ALGO_RESULT') || str('ROBOKASSA_ALGO', 'md5');
  },
  get rkAlgoSuccess() {
    return str('ROBOKASSA_ALGO_SUCCESS') || str('ROBOKASSA_ALGO', 'md5');
  },
  /** Система налогообложения в чеке. Пусто — берётся из кабинета магазина. */
  get rkSno() {
    return str('ROBOKASSA_SNO');
  },
  /**
   * Свой имитатор уведомлений: пока ключей Робокассы нет, оплату надо
   * чем-то проверять. Включается ОТДЕЛЬНОЙ переменной и на боевых
   * ключах обязан быть выключен.
   */
  get payFakeSecret() {
    return str('SPOTIK_FAKE_PAY_SECRET');
  },
};
