import { initializeRuntimeLanguage, setRuntimeLanguage } from './RuntimeLanguage';
import type { Language } from '../i18n';

let initialization: Promise<void> | null = null;
let ready = false;

/** UI、同步和短信 Headless 共用基础初始化；不启动网络或后台任务。 */
export function initializeAppFoundation(): Promise<void> {
  if (!initialization) {
    initialization = initializeRuntimeLanguage().then(
      () => {
        ready = true;
      },
      (error) => {
        initialization = null;
        throw error;
      }
    );
  }
  return initialization;
}

/** 已完成初始化的运行时再次打开 UI 时可直接显示。 */
export function isAppFoundationReady(): boolean {
  return ready;
}

/** 主动切换语言必须等待启动读取完成，防止旧偏好覆盖用户选择。 */
export async function setAppLanguage(language: Language): Promise<void> {
  await initializeAppFoundation();
  await setRuntimeLanguage(language);
}
