import { createInstance } from 'i18next';
import zh from '../i18n/locales/zh';
import en from '../i18n/locales/en';
import { formatLifetimeRecord } from '../utils/statisticsFormatting';
import { createStatisticsStore } from '../stores/statisticsStore';

it.each(['en', 'zh'])(
  'formats rows and exported text in the selected language: %s',
  async (locale) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      interpolation: { escapeValue: false },
      resources: { en: { translation: en }, zh: { translation: zh } },
    });
    const formatting = { t: i18n.t.bind(i18n), locale };
    const startedAt = '2026-10-17T01:00:00.000Z';
    const record = { startedAt, lastHeartbeat: '2026-10-17T02:02:03.000Z' };
    const output = formatLifetimeRecord(record, 0, formatting);
    expect(output).toContain(locale === 'en' ? 'Started:' : '启动:');
    expect(output).toContain(locale === 'en' ? '1h 2m' : '1小时 2分钟');
    expect(output).toContain(
      new Date(startedAt).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    );
    if (locale === 'en') expect(output).not.toMatch(/[\u4e00-\u9fff]/);
    const store = createStatisticsStore({
      storage: { getItem: async () => null, setItem: async () => {} },
      now: () => new Date(record.lastHeartbeat),
    });
    expect(store.getState().getStatisticsText(formatting)).toContain(
      locale === 'en' ? 'No lifetime records' : '暂无存活记录'
    );
    await store.getState().recordAppStart(startedAt);
    const text = store.getState().getStatisticsText(formatting);
    expect(text).toContain(output);
    if (locale === 'en') expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    const legacy = formatLifetimeRecord({ ...record, legacyBackground: true }, 0, formatting);
    expect(legacy).toContain(locale === 'en' ? 'Background record (legacy)' : '后台记录（旧版）');
  }
);

it('switches the exported language without changing stored records and localizes short/day durations', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'zh',
    interpolation: { escapeValue: false },
    resources: { en: { translation: en }, zh: { translation: zh } },
  });
  const t = i18n.t.bind(i18n);
  const short = {
    startedAt: '2026-10-17T01:00:00.000Z',
    lastHeartbeat: '2026-10-17T01:00:05.000Z',
  };
  expect(formatLifetimeRecord(short, 0, { t, locale: 'zh' })).toContain('5秒');
  await i18n.changeLanguage('en');
  expect(formatLifetimeRecord(short, 0, { t, locale: 'en' })).toContain('5s');
  expect(
    formatLifetimeRecord({ ...short, lastHeartbeat: '2026-10-18T01:00:00.000Z' }, 0, {
      t,
      locale: 'en',
    })
  ).toContain('1d');
  expect(
    formatLifetimeRecord({ ...short, lastHeartbeat: '2026-10-16T01:00:00.000Z' }, 0, {
      t,
      locale: 'en',
    })
  ).toContain('0s');
});
