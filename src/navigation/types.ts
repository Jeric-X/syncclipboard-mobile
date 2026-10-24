export type SettingsDetailSection =
  | 'syncAndHistorySection'
  | 'backgroundTasksSection'
  | 'permissionsSection'
  | 'storageSection'
  | 'logsAndDebugSection';

export type SettingsStackParamList = {
  SettingsMain: undefined;
  SettingsDetail: { section: SettingsDetailSection };
  NetworkAutoSwitch: undefined;
  NetworkRuleEditor: { ruleId?: string; duplicateFromId?: string } | undefined;
  CurrentNetwork: undefined;
};
