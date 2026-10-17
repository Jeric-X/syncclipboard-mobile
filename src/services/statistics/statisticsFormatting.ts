import type { TFunction } from 'i18next';
import type { HeadlessLifetimeRecord } from '../../stores/statisticsStore';

export interface StatisticsFormatting {
  t: TFunction;
  locale: string;
}

function formatDuration(ms: number, t: TFunction): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const parts: string[] = [];
  if (days > 0) parts.push(t('settings.statisticsDays', { count: days }));
  if (hours % 24 > 0) parts.push(t('settings.statisticsHours', { count: hours % 24 }));
  if (minutes % 60 > 0) parts.push(t('settings.statisticsMinutes', { count: minutes % 60 }));
  if (parts.length === 0) parts.push(t('settings.statisticsSeconds', { count: seconds }));
  return parts.join(' ');
}

function formatTime(isoString: string, locale: string): string {
  return new Date(isoString).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** 查看列表与复制文本共用当前语言、时区下的记录格式。 */
export function formatLifetimeRecord(
  record: HeadlessLifetimeRecord,
  index: number,
  { t, locale }: StatisticsFormatting
): string {
  return [
    `${index + 1}. ${t('settings.statisticsLifetimeRecord')}`,
    t('settings.statisticsStartedAt', { time: formatTime(record.startedAt, locale) }),
    t('settings.statisticsLastActive', { time: formatTime(record.lastHeartbeat, locale) }),
    t('settings.statisticsDuration', {
      duration: formatDuration(Date.parse(record.lastHeartbeat) - Date.parse(record.startedAt), t),
    }),
  ].join('\n');
}

/** 完整导出也使用界面当前语言，包括标题、计数和空状态。 */
export function formatStatisticsText(
  records: HeadlessLifetimeRecord[],
  max: number,
  formatting: StatisticsFormatting
): string {
  const { t } = formatting;
  return [
    `=== ${t('settings.statisticsLifetimeTitle')} ===`,
    t('settings.statisticsCount', { count: records.length, max }),
    ...records.map((record, index) => formatLifetimeRecord(record, index, formatting)),
    ...(records.length === 0 ? [t('settings.statisticsEmpty')] : []),
  ].join('\n\n');
}
