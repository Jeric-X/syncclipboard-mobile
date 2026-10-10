import { useEffect, useState } from 'react';

/** 保留设置控件的本地即时状态，配置加载或外部值改变时同步。 */
export function useSyncedState<T>(value: T) {
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => {
    setLocalValue(value);
  }, [value]);
  return [localValue, setLocalValue] as const;
}
