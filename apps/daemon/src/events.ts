import { EventEmitter } from 'node:events';

export type DaemonEvent = {
  type: 'project.created';
  projectId: string;
  projectName: string;
  occurredAt: string;
};

export class DaemonEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: DaemonEvent) {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: DaemonEvent) => void) {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }
}
