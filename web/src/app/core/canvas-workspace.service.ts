import { Injectable, computed, signal } from '@angular/core';
import type { ArtifactEnvelope } from './artifact.types';

export type CanvasTabKind = 'markdown' | 'json' | 'code' | 'image' | 'audio' | 'html' | 'pdf' | 'document';
export type CanvasSource = 'chat' | 'run';

export interface CanvasTab {
  id: string;
  title: string;
  kind: CanvasTabKind;
  source: CanvasSource;
  sourceId: string;
  updatedAt: number;
  content?: string;
  artifact?: ArtifactEnvelope;
}

const STORAGE_KEY = 'aidream.canvasTabs.v1';
const MAX_TABS = 32;
const TAB_KINDS = new Set<CanvasTabKind>(['markdown', 'json', 'code', 'image', 'audio', 'html', 'pdf', 'document']);

@Injectable({ providedIn: 'root' })
export class CanvasWorkspaceService {
  readonly tabs = signal<CanvasTab[]>(restoreTabs());
  readonly activeTabId = signal<string | null>(restoreActive(this.tabs()));
  readonly activeTab = computed(() => this.tabs().find(tab => tab.id === this.activeTabId()) ?? null);
  private readonly closedIds = new Set(restoreClosedIds());

  registerText(id: string, title: string, kind: 'markdown' | 'json' | 'code' | 'html',
               content: string, source: CanvasSource, sourceId: string): CanvasTab {
    return this.upsert({ id, title, kind, content, source, sourceId,
      updatedAt: Date.now() }, false);
  }

  registerArtifact(artifact: ArtifactEnvelope): CanvasTab {
    return this.upsert({
      id: artifactTabId(artifact), title: artifact.name,
      kind: artifactKind(artifact), artifact, source: artifact.owner.type === 'run' ? 'run' : 'chat',
      sourceId: artifact.owner.id, updatedAt: Date.now(),
    }, false);
  }

  openText(id: string, title: string, kind: 'markdown' | 'json' | 'code' | 'html',
           content: string, source: CanvasSource, sourceId: string): CanvasTab {
    this.closedIds.delete(id);
    const tab = this.registerText(id, title, kind, content, source, sourceId);
    this.activate(tab.id);
    return tab;
  }

  openArtifact(artifact: ArtifactEnvelope): CanvasTab {
    this.closedIds.delete(artifactTabId(artifact));
    const tab = this.registerArtifact(artifact);
    this.activate(tab.id);
    return tab;
  }

  activate(id: string): void {
    if (this.tabs().some(tab => tab.id === id)) {
      this.activeTabId.set(id);
      this.persist();
    }
  }

  updateText(id: string, content: string): void {
    const current = this.tabs();
    const index = current.findIndex(tab => tab.id === id && tab.artifact === undefined);
    if (index < 0 || current[index].content === content) return;
    const next = current.slice();
    next[index] = { ...current[index], content, updatedAt: Math.max(Date.now(), current[index].updatedAt + 1) };
    this.tabs.set(next);
    this.persist();
  }

  close(id: string): void {
    const tabs = this.tabs();
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    this.closedIds.add(id);
    while (this.closedIds.size > 256) this.closedIds.delete(this.closedIds.values().next().value!);
    const next = tabs.filter(tab => tab.id !== id);
    this.tabs.set(next);
    if (this.activeTabId() === id) this.activeTabId.set(next[Math.min(index, next.length - 1)]?.id ?? null);
    this.persist();
  }

  private upsert(tab: CanvasTab, activate: boolean): CanvasTab {
    if (!activate && this.closedIds.has(tab.id)) return tab;
    const current = this.tabs();
    const existingIndex = current.findIndex(item => item.id === tab.id);
    let next: CanvasTab[];
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      if (sameTabContent(existing, tab)) {
        const active = this.activeTabId();
        if (active && current.some(item => item.id === active)) return existing;
        tab = existing;
      }
      next = current.slice();
      next[existingIndex] = tab;
    } else {
      next = [...current, tab];
    }
    const existingActive = this.activeTabId();
    if (next.length > MAX_TABS) {
      const removeCount = next.length - MAX_TABS;
      const removable = next.filter(item => item.id !== existingActive).slice(0, removeCount).map(item => item.id);
      next = next.filter(item => !removable.includes(item.id));
    }
    this.tabs.set(next);
    if (activate || !existingActive || !next.some(item => item.id === existingActive)) this.activeTabId.set(tab.id);
    this.persist();
    return tab;
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: this.tabs(), activeTabId: this.activeTabId(), closedIds: [...this.closedIds] }));
    } catch { /* Keep the workspace usable when storage is unavailable or full. */ }
  }
}

function sameTabContent(left: CanvasTab, right: CanvasTab): boolean {
  return left.title === right.title && left.kind === right.kind && left.source === right.source
    && left.sourceId === right.sourceId && left.content === right.content
    && JSON.stringify(left.artifact) === JSON.stringify(right.artifact);
}

export function artifactTabId(artifact: ArtifactEnvelope): string {
  return `artifact:${artifact.owner.type}:${artifact.owner.id}:${artifact.id}`;
}

function artifactKind(artifact: ArtifactEnvelope): CanvasTabKind {
  const mediaType = artifact.media_type.toLowerCase();
  if (artifact.kind === 'image' || mediaType.startsWith('image/')) return 'image';
  if (artifact.kind === 'audio' || mediaType.startsWith('audio/')) return 'audio';
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') return 'html';
  if (artifact.kind === 'json' || mediaType === 'application/json' || mediaType.endsWith('+json')) return 'json';
  if (mediaType === 'text/markdown' || /\.md(?:own)?$/i.test(artifact.name)) return 'markdown';
  return 'document';
}

function restoreTabs(): CanvasTab[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as { tabs?: unknown } | null;
    if (!Array.isArray(value?.tabs)) return [];
    return value.tabs.slice(-MAX_TABS).filter((tab): tab is CanvasTab => validTab(tab));
  } catch { return []; }
}

function restoreActive(tabs: CanvasTab[]): string | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as { activeTabId?: unknown } | null;
    return typeof value?.activeTabId === 'string' && tabs.some(tab => tab.id === value.activeTabId)
      ? value.activeTabId : tabs[0]?.id ?? null;
  } catch { return tabs[0]?.id ?? null; }
}

function restoreClosedIds(): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as { closedIds?: unknown } | null;
    return Array.isArray(value?.closedIds)
      ? value.closedIds.filter((id): id is string => typeof id === 'string' && id.length <= 1024).slice(-256)
      : [];
  } catch { return []; }
}

function validTab(value: unknown): value is CanvasTab {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tab = value as Partial<CanvasTab>;
  if (typeof tab.id !== 'string' || !tab.id || tab.id.length > 1024
      || typeof tab.title !== 'string' || !tab.title || tab.title.length > 255
      || !TAB_KINDS.has(tab.kind as CanvasTabKind)
      || (tab.source !== 'chat' && tab.source !== 'run')
      || typeof tab.sourceId !== 'string' || !tab.sourceId
      || typeof tab.updatedAt !== 'number') return false;
  if (tab.content !== undefined && typeof tab.content !== 'string') return false;
  if (tab.artifact !== undefined && (!tab.artifact || typeof tab.artifact.id !== 'string')) return false;
  return tab.content !== undefined || !!tab.artifact;
}
