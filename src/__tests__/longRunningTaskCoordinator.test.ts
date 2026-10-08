import { LongRunningTaskCoordinator } from '../utils/longRunningTaskCoordinator';
import { LongRunningTask } from '../longRunningTask/LongRunningTask';

class TestTask extends LongRunningTask {
  running = false;
  constructor(readonly name: string) {
    super();
  }
  start = jest.fn(async () => {
    this.running = true;
  });
  stop = jest.fn(async () => {
    this.running = false;
  });
  isRunning = () => this.running;
  onBackground = jest.fn(async () => {});
  onForeground = jest.fn(async () => {});
  onConfigChanged = jest.fn(async () => {});
}

describe('shared sync runtime lifecycle', () => {
  it('starts once for concurrent UI and Headless entry points', async () => {
    const manager = new LongRunningTaskCoordinator(
      async () => ({ foreground: false, backgroundEnabled: true }),
      jest.fn()
    );
    const task = new TestTask('sync');
    manager.register(task);
    await Promise.all([manager.startAll(), manager.startAll()]);
    expect(task.start).toHaveBeenCalledTimes(1);
    expect(task.onBackground).toHaveBeenCalled();
    expect(task.onForeground).not.toHaveBeenCalled();
  });

  it('applies background policy immediately on a cold start without AppState events', async () => {
    const manager = new LongRunningTaskCoordinator(
      async () => ({ foreground: false, backgroundEnabled: false }),
      jest.fn()
    );
    const sync = new TestTask('sync');
    const monitor = new TestTask('monitor');
    manager.register(sync);
    manager.register(monitor, true);
    await manager.startAll();
    expect(sync.start).not.toHaveBeenCalled();
    expect(sync.stop).toHaveBeenCalled();
    expect(monitor.start).toHaveBeenCalledTimes(1);
    expect(monitor.onBackground).toHaveBeenCalledTimes(1);
  });

  it('serializes a stop arriving during startup and does not resurrect on config changes', async () => {
    const manager = new LongRunningTaskCoordinator(
      async () => ({ foreground: false, backgroundEnabled: true }),
      jest.fn()
    );
    const task = new TestTask('sync');
    let finishStarting!: () => void;
    task.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStarting = () => {
            task.running = true;
            resolve();
          };
        })
    );
    manager.register(task);
    const start = manager.startAll();
    await Promise.resolve();
    await Promise.resolve();
    const stop = manager.stopAll();
    expect(task.stop).not.toHaveBeenCalled();
    finishStarting();
    await Promise.all([start, stop]);
    await manager.refresh(true);
    expect(task.running).toBe(false);
    expect(task.start).toHaveBeenCalledTimes(1);
  });

  it('starts network selection and sync callbacks before clipboard monitoring', async () => {
    const order: string[] = [];
    const manager = new LongRunningTaskCoordinator(
      async () => ({ foreground: true, backgroundEnabled: false }),
      jest.fn()
    );
    for (const name of ['network', 'sync', 'monitor']) {
      const task = new TestTask(name);
      task.start.mockImplementation(async () => {
        order.push(name);
        task.running = true;
      });
      manager.register(task);
    }
    await manager.startAll();
    expect(order).toEqual(['network', 'sync', 'monitor']);
  });

  it('does not start any tasks from configuration notifications before explicit startup', async () => {
    const manager = new LongRunningTaskCoordinator(
      async () => ({ foreground: true, backgroundEnabled: true }),
      jest.fn()
    );
    const task = new TestTask('sync');
    manager.register(task);
    await manager.refresh(true);
    expect(task.start).not.toHaveBeenCalled();
  });
});
