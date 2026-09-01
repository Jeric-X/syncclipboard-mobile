import type { ISyncClipboardAPI } from '@/api/clients/APIClient';
import type { ProfileDto } from '@/types/api';
import type { AppConfig } from '@/types/storage';

const FIRST_RETRY_DELAY_MS = 3_000;
const SUBSEQUENT_RETRY_DELAY_MS = 10_000;
// Headless JS 上限为 60 秒，超过 50 秒不再安排下一轮，为日志与服务收尾预留时间。
const RETRY_WINDOW_MS = 50_000;

export interface SmsCodeUploadRequest {
  from: string;
  body: string;
}

export type SmsCodeUploadStage =
  | 'validation'
  | 'code-extraction'
  | 'clipboard-copy'
  | 'config-load'
  | 'network-preflight'
  | 'client-create'
  | 'upload';

export type SmsCodeUploadResult =
  | { status: 'uploaded'; attempts: number }
  | {
      status: 'skipped';
      reason: 'missing-body' | 'no-code' | 'disabled' | 'no-config' | 'no-active-server';
    }
  | { status: 'failed'; stage: SmsCodeUploadStage; error: string };

type SmsLogLevel = 'info' | 'warn' | 'error';

export interface SmsCodeUploaderDependencies {
  now(): number;
  sleep(delayMs: number): Promise<void>;
  log(level: SmsLogLevel, message: string, error?: unknown): void;
  extractVerificationCode(body: string): string | null;
  copyToClipboard(code: string): Promise<void>;
  loadConfig(): Promise<AppConfig | null>;
  selectServerForCurrentNetworkOnce(): Promise<void>;
  getAPIClient(): Promise<ISyncClipboardAPI>;
  calculateHash(text: string): string;
  updateNotification(text: string): void;
  notifyUploadSucceeded(code: string): void;
}

interface ErrorDetails {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  response?: { status?: unknown };
}

function formatError(error: unknown): string {
  if (!(error instanceof Error) && (typeof error !== 'object' || error === null)) {
    return String(error);
  }

  const details = error as ErrorDetails;
  const parts = [
    typeof details.name === 'string' ? details.name : undefined,
    typeof details.message === 'string' ? details.message : undefined,
    typeof details.code === 'string' ? `code=${details.code}` : undefined,
    typeof details.response?.status === 'number' ? `status=${details.response.status}` : undefined,
  ].filter(Boolean);
  return parts.join(': ') || String(error);
}

function serverSummary(config: AppConfig): string {
  const server = config.servers[config.activeServerIndex];
  if (!server) return 'none';

  let endpoint = 'invalid-url';
  try {
    const parsed = new URL(server.url);
    endpoint = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // 不把可能含有凭据或路径的无效 URL 写入日志。
  }

  return `index=${config.activeServerIndex} id=${server.id ?? 'missing'} type=${server.type} endpoint=${endpoint}`;
}

function retryDelayMs(attempt: number): number {
  return attempt === 0 ? FIRST_RETRY_DELAY_MS : SUBSEQUENT_RETRY_DELAY_MS;
}

/**
 * 执行短信验证码上传流程。所有外部能力均通过依赖注入，确保冷启动路径可测试。
 */
async function executeSmsCodeUpload(
  taskData: SmsCodeUploadRequest | undefined,
  deps: SmsCodeUploaderDependencies
): Promise<SmsCodeUploadResult> {
  let stage: SmsCodeUploadStage = 'validation';
  const startedAt = deps.now();
  const taskId = startedAt.toString(36);
  const log = (level: SmsLogLevel, message: string, error?: unknown): void => {
    deps.log(
      level,
      `[SmsUploadTask] task=${taskId} stage=${stage} elapsedMs=${Math.max(
        0,
        deps.now() - startedAt
      )} ${message}`,
      error
    );
  };
  const updateNotification = (text: string): void => {
    try {
      deps.updateNotification(text);
    } catch (error) {
      log('warn', `notification update failed error=${formatError(error)}`, error);
    }
  };

  try {
    if (!taskData?.body) {
      log('warn', 'skipped reason=missing-body');
      return { status: 'skipped', reason: 'missing-body' };
    }
    log(
      'info',
      `started senderPresent=${taskData.from.length > 0} bodyLength=${taskData.body.length}`
    );

    stage = 'code-extraction';
    const code = deps.extractVerificationCode(taskData.body);
    if (!code) {
      log('info', 'skipped reason=no-verification-code');
      return { status: 'skipped', reason: 'no-code' };
    }
    log('info', `verification code extracted codeLength=${code.length}`);

    stage = 'clipboard-copy';
    try {
      await deps.copyToClipboard(code);
      log('info', 'clipboard copy completed');
    } catch (error) {
      log('warn', `clipboard copy failed error=${formatError(error)}`, error);
    }

    stage = 'config-load';
    let config = await deps.loadConfig();
    if (!config) {
      log('error', 'stopped reason=no-config');
      return { status: 'skipped', reason: 'no-config' };
    }
    log(
      'info',
      `config loaded forwardingEnabled=${config.enableSmsForwarding} serverCount=${
        config.servers.length
      } activeServer=${serverSummary(config)} autoSwitchEnabled=${
        config.networkAutoSwitch?.enabled ?? false
      }`
    );

    if (!config.enableSmsForwarding) {
      log('info', 'skipped reason=sms-forwarding-disabled');
      return { status: 'skipped', reason: 'disabled' };
    }

    const profile: ProfileDto = {
      type: 'Text',
      text: code,
      hash: deps.calculateHash(code),
      hasData: false,
    };
    updateNotification(`正在上传验证码：${code}`);

    for (let attempt = 0; ; attempt++) {
      const attemptNumber = attempt + 1;
      const attemptStartedAt = deps.now();
      stage = 'network-preflight';
      log('info', `attempt=${attemptNumber} started`);
      try {
        log('info', 'one-shot network server selection started');
        await deps.selectServerForCurrentNetworkOnce();
        log('info', 'one-shot network server selection completed');

        stage = 'config-load';
        config = await deps.loadConfig();
        if (!config) {
          log('error', 'stopped reason=config-unavailable-after-network-preflight');
          return { status: 'skipped', reason: 'no-config' };
        }
        log('info', `post-selection config loaded activeServer=${serverSummary(config)}`);

        const server = config.servers[config.activeServerIndex];
        if (!server?.url) {
          log('error', 'stopped reason=no-active-server');
          return { status: 'skipped', reason: 'no-active-server' };
        }

        stage = 'client-create';
        log('info', `API client creation started server=${serverSummary(config)}`);
        const client = await deps.getAPIClient();
        log('info', 'API client creation completed');

        stage = 'upload';
        log('info', `upload attempt=${attemptNumber} started`);
        await client.putClipboard(profile);
      } catch (error) {
        const errorText = formatError(error);
        const attemptMs = Math.max(0, deps.now() - attemptStartedAt);
        const elapsedMs = Math.max(0, deps.now() - startedAt);
        const delay = retryDelayMs(attempt);
        const canRetry = elapsedMs + delay <= RETRY_WINDOW_MS;
        log(
          canRetry ? 'warn' : 'error',
          `attempt=${attemptNumber} failed attemptMs=${attemptMs} error=${errorText}`,
          error
        );
        if (!canRetry) {
          updateNotification(`验证码上传失败: ${code}\n已尝试${attemptNumber}次`);
          log('error', `retry window exhausted elapsedMs=${elapsedMs}`);
          return { status: 'failed', stage, error: errorText };
        }

        updateNotification(
          `验证码上传重试中: ${code}\n第${attemptNumber}次失败，${Math.round(
            delay / 1000
          )}秒后重试…`
        );
        log('info', `retry scheduled delayMs=${delay}`);
        await deps.sleep(delay);
        continue;
      }

      log(
        'info',
        `upload attempt=${attemptNumber} succeeded attemptMs=${Math.max(
          0,
          deps.now() - attemptStartedAt
        )}`
      );
      try {
        deps.notifyUploadSucceeded(code);
      } catch (error) {
        log('warn', `success notification failed error=${formatError(error)}`, error);
      }
      log('info', `completed result=uploaded attempts=${attemptNumber}`);
      return { status: 'uploaded', attempts: attemptNumber };
    }

    return { status: 'failed', stage, error: 'Retry loop exited unexpectedly' };
  } catch (error) {
    const errorText = formatError(error);
    log('error', `failed error=${errorText}`, error);
    return { status: 'failed', stage, error: errorText };
  }
}

/** 短信验证码上传业务服务。 */
export class SmsCodeUploader {
  constructor(private readonly deps: SmsCodeUploaderDependencies) {}

  /** 执行验证码提取、选服、上传和重试。 */
  upload(taskData: SmsCodeUploadRequest | undefined): Promise<SmsCodeUploadResult> {
    return executeSmsCodeUpload(taskData, this.deps);
  }
}
