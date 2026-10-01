import { Injectable, signal } from '@angular/core';

export type InterfaceMode = 'standard' | 'advanced';

const STORAGE_KEY = 'aidream.interfaceMode.v1';

function readStoredMode(): InterfaceMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'advanced' ? 'advanced' : 'standard';
  } catch {
    return 'standard';
  }
}

@Injectable({ providedIn: 'root' })
export class InterfaceModeService {
  readonly mode = signal<InterfaceMode>(readStoredMode());

  setMode(value: unknown): void {
    if (value !== 'standard' && value !== 'advanced') return;
    this.mode.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The current page still reflects the choice if browser storage is unavailable.
    }
  }
}
