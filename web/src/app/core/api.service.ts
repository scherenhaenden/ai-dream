import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

export type ConnectionState = 'checking' | 'connected' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly storedBase = localStorage.getItem('aidream.apiBase') || '';
  private readonly base = isLocalApiBase(this.storedBase) ? this.storedBase : 'http://127.0.0.1:8765';
  readonly baseUrl = signal(this.base);
  readonly connection = signal<ConnectionState>('checking');
  readonly error = signal<string | null>(null);
  readonly connected = computed(() => this.connection() === 'connected');

  constructor(private readonly http: HttpClient) { void this.check(); }

  async check(): Promise<void> {
    this.connection.set('checking');
    try {
      await firstValueFrom(this.http.get(`${this.baseUrl()}/api/health`, { responseType: 'json' }).pipe(timeout(2000)));
      this.connection.set('connected');
      this.error.set(null);
    } catch (e) {
      this.connection.set('unavailable');
      this.error.set(e instanceof Error ? e.message : 'Could not reach local API');
    }
  }

  setBaseUrl(value: string): boolean {
    const normalized = value.trim();
    if (!isLocalApiBase(normalized)) return false;
    this.baseUrl.set(normalized);
    localStorage.setItem('aidream.apiBase', normalized);
    void this.check();
    return true;
  }

  get<T>(path: string) { return this.http.get<T>(`${this.baseUrl()}${path}`); }
  post<T>(path: string, body: unknown) { return this.http.post<T>(`${this.baseUrl()}${path}`, body); }
}

export function isLocalApiBase(value: string): boolean {
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(value.trim());
  if (!match) return false;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
