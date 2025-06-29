import type * as tsvfs from '@site/src/vendor/typescript-vfs';
import type * as ts from 'typescript';

import type { ConfigModel } from '../types';
import type { PlaygroundSystem } from './types';

import { debounce } from '../lib/debounce';
import { getPathRegExp } from './utils';

export function createFileSystem(
  config: Pick<ConfigModel, 'code' | 'eslintrc' | 'fileType' | 'tsconfig'>,
  vfs: typeof tsvfs,
): PlaygroundSystem {
  const files = new Map<string, string>();
  files.set(`/.eslintrc`, config.eslintrc);
  files.set(`/tsconfig.json`, config.tsconfig);
  if (config.code !== '') {
    files.set(`/input${config.fileType}`, config.code);
  }

  const fileWatcherCallbacks = new Map<RegExp, Set<ts.FileWatcherCallback>>();

  const system = vfs.createSystem(files) as PlaygroundSystem;

  system.watchFile = (
    path,
    callback,
    pollingInterval = 500,
  ): ts.FileWatcher => {
    const cb = pollingInterval ? debounce(callback, pollingInterval) : callback;
    const expPath = getPathRegExp(path);
    let handle = fileWatcherCallbacks.get(expPath);
    if (!handle) {
      handle = new Set();
      fileWatcherCallbacks.set(expPath, handle);
    }
    handle.add(cb);

    return {
      close: (): void => {
        fileWatcherCallbacks.get(expPath)?.delete(cb);
      },
    };
  };

  const triggerCallbacks = (
    path: string,
    type: ts.FileWatcherEventKind,
  ): void => {
    fileWatcherCallbacks.forEach((callbacks, key) => {
      if (key.test(path)) {
        callbacks.forEach(cb => cb(path, type));
      }
    });
  };

  system.deleteFile = (fileName): void => {
    files.delete(fileName);
    triggerCallbacks(fileName, 1);
  };

  system.writeFile = (fileName, contents): void => {
    if (!contents) {
      contents = '';
    }
    const file = files.get(fileName);
    if (file === contents) {
      // do not trigger callbacks if the file has not changed
      return;
    }
    files.set(fileName, contents);
    triggerCallbacks(fileName, file ? 2 : 0);
  };

  system.removeFile = (fileName): void => {
    files.delete(fileName);
  };

  system.searchFiles = (path: string): string[] => {
    const expPath = getPathRegExp(path);
    return [...files.keys()].filter(fileName => expPath.test(fileName));
  };
  system.getScriptFileNames = (): string[] => {
    return [...files.keys()]
      .filter(fileName => !fileName.startsWith('/lib.'))
      .filter(f => !f.endsWith('/.eslintrc') && !f.endsWith('.json'));
  };
  return system;
}
