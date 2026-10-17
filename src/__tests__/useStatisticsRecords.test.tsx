import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { useStatisticsRecords } from '../hooks/useStatisticsRecords';
import { useStatisticsStore } from '../stores/statisticsStore';

it('does not rerender closed statistics, but shows current data when reopened', async () => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const original = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  let renders = 0;
  function Statistics({ visible }: { visible: boolean }) {
    const records = useStatisticsRecords(visible);
    renders++;
    return React.createElement('records', { records });
  }
  let root: ReturnType<typeof TestRenderer.create>;
  const update = () =>
    useStatisticsStore.setState({
      data: {
        appLifetimeRecords: [
          { startedAt: '2026-10-17T01:00:00.000Z', lastHeartbeat: new Date().toISOString() },
        ],
      },
    });
  try {
    await act(async () => {
      root = TestRenderer.create(<Statistics visible={false} />);
    });
    const closedRenders = renders;
    await act(async () => {
      update();
    });
    expect(renders).toBe(closedRenders);
    await act(async () => {
      root.update(<Statistics visible />);
    });
    expect(root.toJSON().props.records).toEqual(
      useStatisticsStore.getState().data.appLifetimeRecords
    );
    const openRenders = renders;
    await act(async () => {
      update();
    });
    expect(renders).toBeGreaterThan(openRenders);
    await act(async () => {
      root.update(<Statistics visible={false} />);
    });
    const reclosedRenders = renders;
    await act(async () => {
      update();
    });
    expect(renders).toBe(reclosedRenders);
  } finally {
    await act(async () => {
      root?.unmount();
    });
    testGlobal.IS_REACT_ACT_ENVIRONMENT = original;
  }
});
