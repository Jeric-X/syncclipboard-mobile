import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { useSyncedState } from '../hooks/useSyncedState';

it('配置加载和外部修改刷新开关，源值未变时保留本地即时操作', async () => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const original = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  let setLocal!: (enabled: boolean) => void;
  function Toggle({ saved }: { saved?: boolean }) {
    const [enabled, setEnabled] = useSyncedState(saved ?? false);
    setLocal = setEnabled;
    return React.createElement('switch', { value: enabled });
  }
  let root: ReturnType<typeof TestRenderer.create>;
  try {
    await act(async () => {
      root = TestRenderer.create(<Toggle />);
    });
    expect(root.toJSON().props.value).toBe(false);
    await act(async () => {
      root.update(<Toggle saved={true} />);
    });
    expect(root.toJSON().props.value).toBe(true);
    await act(async () => {
      root.update(<Toggle saved={false} />);
    });
    expect(root.toJSON().props.value).toBe(false);
    await act(async () => {
      setLocal(true);
    });
    await act(async () => {
      root.update(<Toggle saved={false} />);
    });
    expect(root.toJSON().props.value).toBe(true);
  } finally {
    await act(async () => {
      root?.unmount();
    });
    testGlobal.IS_REACT_ACT_ENVIRONMENT = original;
  }
});
