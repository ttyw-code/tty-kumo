import type { DisposableStore, IDisposable } from '@/base/lifecycle';

/**
 * 通用事件订阅契约（VSCode 风格）。
 *
 * 单独放一个文件的原因：`lifecycle.ts` 只负责 Disposable 的生命周期，
 * 而 Event 是「可被订阅的东西」的通用契约 —— IPC 的 `listen`、
 * InstantiationService 的服务事件都依赖它。
 *
 * 此前项目里散着三份各自为政的定义（common/ipc.ts 与
 * platform/instantiation/common/instantiationService.ts 各一份），
 * 签名本文件为准；新增事件类型请从这里引用。
 */
export interface Event<T> {
	(
		listener: (e: T) => unknown,
		thisArgs?: any,
		disposables?: IDisposable[] | DisposableStore,
	): IDisposable;
}
