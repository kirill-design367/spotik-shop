/**
 * Только типы. Ни одного значения — иначе three попал бы в первый чанк
 * даже при динамическом импорте самой сцены.
 */
export type SceneKind = 'card' | 'gift';

export type SceneHandle = {
  /** Пересобрать под новый размер контейнера. */
  resize: () => void;
  /**
   * Рубильник цикла. В этой итерации он выключен: сцена рисует один кадр
   * и останавливается. Во второй итерации анимация включается отсюда,
   * ничего не переписывая.
   */
  setLoop: (on: boolean) => void;
  /** Полная выгрузка: геометрия, материалы, окружение, рендерер, контекст. */
  dispose: () => void;
};

export type SceneInit = (host: HTMLElement, opts: { kind: SceneKind; seed: number }) => Promise<SceneHandle>;
