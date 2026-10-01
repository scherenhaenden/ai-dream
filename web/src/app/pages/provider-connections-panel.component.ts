import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ProviderConnection,
  ProviderConnectionsService,
  ProviderModel,
} from '../core/provider-connections.service';

@Component({
  selector: 'app-provider-connections-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="provider-panel" aria-label="External provider connections">
      @if (!storageAvailable()) {
        <div class="provider-warning" role="alert">
          <b>Secure credential storage is unavailable</b>
          <p>{{ storageReason() }}</p>
          <p>Install or repair AI Dream with its keyring dependency, then unlock a supported operating-system credential store (such as Secret Service, KWallet, Keychain, or Windows Credential Locker) and reload this page. AI Dream will not save API keys in a file or browser storage.</p>
        </div>
      }

      @if (loadError()) { <p class="provider-error" role="alert">{{ loadError() }}</p> }
      @if (message()) { <p class="provider-message" role="status">{{ message() }}</p> }

      <section class="provider-editor surface" aria-labelledby="provider-form-title">
        <header class="provider-heading">
          <div><h3 id="provider-form-title">{{ editingId() ? 'Edit connection' : 'Add a connection' }}</h3>
            <p>OpenAI-compatible chat API. Credentials stay in the operating-system keyring.</p></div>
          @if (editingId()) { <button class="quiet-button" type="button" (click)="resetForm()">Cancel edit</button> }
        </header>
        <form (submit)="save($event)" novalidate>
          <div class="provider-form-grid">
            <label>Name
              <input type="text" maxlength="80" autocomplete="off" [value]="name()" (input)="name.set($any($event.target).value)" placeholder="Work API" required>
            </label>
            <label>Base URL
              <input type="url" inputmode="url" autocomplete="url" [value]="baseUrl()" (input)="baseUrl.set($any($event.target).value)" placeholder="https://api.example.com/v1" required>
            </label>
            <label class="provider-key">{{ editingId() ? 'Replace API key (optional)' : 'API key' }}
              <input type="password" autocomplete="new-password" spellcheck="false" [value]="apiKey()" (input)="apiKey.set($any($event.target).value)" [required]="!editingId()" [disabled]="!storageAvailable()" placeholder="{{ editingId() ? 'Leave blank to keep the saved key' : 'Enter the provider key' }}" aria-describedby="provider-key-help">
            </label>
          </div>
          <p id="provider-key-help" class="provider-help">The key is sent only in the local API request body, stored by the OS keyring, and cleared from this form after a successful save. It is never returned by the API.</p>
          @if (editingId() && credentialConfigured()) {
            <label class="clear-credential"><input type="checkbox" [checked]="clearCredential()" (change)="clearCredential.set($any($event.target).checked)"> Remove the saved credential and disable this connection</label>
          }
          @if (formError()) { <p class="provider-error" role="alert">{{ formError() }}</p> }
          <div class="provider-actions">
            <button class="provider-primary" type="submit" [disabled]="saving() || !name().trim() || !baseUrl().trim() || (!editingId() && !storageAvailable()) || (!editingId() && !apiKey())">
              {{ saving() ? 'Saving…' : editingId() ? 'Save connection' : 'Save connection securely' }}
            </button>
            @if (editingId() && credentialConfigured()) {
              <span class="saved-credential" aria-label="Saved credential is stored securely">Credential saved securely</span>
            }
          </div>
        </form>
      </section>

      <section class="provider-list" aria-labelledby="provider-list-title">
        <header class="provider-heading"><div><h3 id="provider-list-title">Connections</h3><p>Remote connections and their status.</p></div>
          <button class="quiet-button" type="button" (click)="load()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button></header>
        @if (loading() && connections().length === 0) { <p class="provider-empty" role="status">Loading connections…</p> }
        @else if (connections().length === 0) { <p class="provider-empty">No external connections configured.</p> }
        @else {
          <div class="provider-cards">
            @for (connection of connections(); track connection.id) {
              <article class="provider-card surface">
                <header><div class="provider-card-title"><b>{{ connection.name }}</b><code>{{ connection.provider_type }}</code></div>
                  <span class="provider-state" [class.enabled]="connection.enabled">{{ connection.enabled ? 'Enabled' : 'Disabled' }}</span></header>
                <p class="provider-endpoint" [title]="connection.base_url">{{ connection.base_url }}</p>
                <p class="credential-state">{{ connection.credential_configured ? 'Credential stored securely' : 'No credential saved' }}</p>
                <div class="provider-card-actions">
                  <button type="button" (click)="edit(connection)">Edit</button>
                  @if (connection.enabled) {
                    <button type="button" (click)="setEnabled(connection, false)" [disabled]="busyId() === connection.id">Disable</button>
                  } @else {
                    <button type="button" (click)="setEnabled(connection, true)" [disabled]="busyId() === connection.id || !connection.credential_configured || !storageAvailable()" [title]="!storageAvailable() ? 'Secure credential storage is unavailable' : !connection.credential_configured ? 'Save an API key before enabling' : 'Enable this provider connection'">Enable</button>
                  }
                  <button type="button" (click)="test(connection)" [disabled]="busyId() === connection.id || !connection.enabled || !storageAvailable()" title="Test the configured connection using a read-only model-list request">Test</button>
                  <button type="button" (click)="discover(connection)" [disabled]="busyId() === connection.id || !connection.enabled || !storageAvailable()" title="Discover models from this remote provider">Models</button>
                  <button type="button" class="danger-button" (click)="remove(connection)" [disabled]="busyId() === connection.id || (connection.credential_configured && !storageAvailable())" [title]="connection.credential_configured && !storageAvailable() ? 'Reconnect secure credential storage before removing this saved credential' : 'Remove this connection'">Remove</button>
                </div>
              </article>
            }
          </div>
        }
      </section>

      @if (models().length || modelsLoaded()) {
        <section class="remote-models surface" aria-labelledby="remote-models-title">
          <header class="provider-heading"><div><h3 id="remote-models-title">Remote provider models</h3><p>Namespaced provider entries, separate from the local GGUF model catalog.</p></div>
            <button class="quiet-button" type="button" (click)="clearModels()">Clear list</button></header>
          @if (!models().length) { <p class="provider-empty">No models were reported by this provider.</p> }
          @else { <ul>@for (model of models(); track model.id) { <li><b>{{ model.name }}</b><code>{{ model.id }}</code><small>{{ model.connection_name }} · remote provider</small></li> }</ul> }
        </section>
      }
      <p class="provider-footnote">Remote provider models are not installed local files. They do not appear in Models or <code>GET /api/models</code>, and chat does not use them yet.</p>
    </div>
  `,
  styles: [`
    :host{display:block;min-width:0}.provider-panel{display:grid;gap:12px;min-width:0}.provider-warning{padding:12px 14px;border:1px solid #735536;border-radius:6px;background:#2a2118;color:#f0d0a3;font-size:10px;line-height:1.55}.provider-warning b{font-size:11px}.provider-warning p{margin:5px 0 0;color:#cfb58e}.provider-editor,.provider-card,.remote-models{min-width:0;padding:15px;border:1px solid #2e3541;border-radius:6px}.provider-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid #2e3541}.provider-heading h3{margin:0;color:#d9deea;font-size:12px;font-weight:550}.provider-heading p{margin:5px 0 0;color:#8992a2;font-size:10px;line-height:1.5}.provider-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.provider-form-grid label{display:grid;gap:5px;min-width:0;color:#bdc4d2;font-size:10px}.provider-form-grid input{box-sizing:border-box;width:100%;min-width:0;padding:8px 9px;border:1px solid #3b4351;border-radius:4px;background:#10151e;color:#e1e7f0;font:10px ui-monospace,monospace}.provider-form-grid input:focus{outline:2px solid #5473a7;outline-offset:1px}.provider-key{grid-column:1/-1}.provider-form-grid input:disabled{opacity:.55;cursor:not-allowed}.provider-help{margin:8px 0 0;color:#848d9d;font-size:9px;line-height:1.5}.clear-credential{display:flex;align-items:center;gap:7px;margin-top:10px;color:#c8a7a4;font-size:9px}.clear-credential input{accent-color:#c56969}.provider-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.provider-primary,.quiet-button,.provider-card-actions button{border:1px solid #3c4657;border-radius:4px;background:#222a38;color:#c7d6f4;padding:7px 9px;font-size:9px;cursor:pointer}.provider-primary{border-color:#5473a7;background:#253750}.provider-primary:disabled,.quiet-button:disabled,.provider-card-actions button:disabled{opacity:.5;cursor:not-allowed}.quiet-button{flex:none;padding:5px 8px}.saved-credential{color:#65c9a0;font-size:9px}.provider-error{margin:6px 0 0;color:#ff9b9b;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.provider-message{margin:0;padding:9px 11px;border:1px solid #315744;border-radius:5px;background:#172921;color:#90deb7;font-size:10px;line-height:1.5}.provider-list{min-width:0}.provider-list>.provider-heading{margin:0 1px 9px}.provider-empty{margin:6px 0;color:#909aaa;font-size:10px;line-height:1.5}.provider-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.provider-card{padding:12px}.provider-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.provider-card-title{display:grid;gap:5px;min-width:0}.provider-card-title b{color:#d9deea;font-size:11px;overflow-wrap:anywhere}.provider-card-title code,.provider-card code,.remote-models code{color:#9db5de;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.provider-state{flex:none;color:#d6b979;font:8px ui-monospace,monospace;text-transform:uppercase}.provider-state.enabled{color:#65c9a0}.provider-endpoint{margin:9px 0 3px;color:#aab5c5;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.credential-state{margin:0;color:#8993a4;font-size:9px}.provider-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.provider-card-actions button{padding:5px 7px}.provider-card-actions button:hover:not(:disabled),.quiet-button:hover:not(:disabled){border-color:#6886b6;background:#2c394d}.provider-card-actions .danger-button{color:#e4a2a2}.remote-models ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}.remote-models li{display:grid;gap:4px;min-width:0;padding:8px;border:1px solid #2c3543;border-radius:4px}.remote-models li b{color:#d6deec;font-size:10px}.remote-models li small{color:#8993a4;font-size:9px}.provider-footnote{margin:0;color:#7f8a9c;font-size:9px;line-height:1.5}.provider-footnote code{color:#aab8d1;font:9px ui-monospace,monospace}
    @media(max-width:700px){.provider-cards{grid-template-columns:1fr}}
    @media(max-width:480px){.provider-form-grid{grid-template-columns:1fr}.provider-key{grid-column:auto}.provider-editor,.provider-card,.remote-models{padding:11px}.provider-card-actions{gap:4px}}
  `],
})
export class ProviderConnectionsPanelComponent implements OnInit {
  readonly connections = signal<ProviderConnection[]>([]);
  readonly secureStorage = signal<{ available: boolean; reason: string | null }>({ available: false, reason: 'Checking secure credential storage.' });
  readonly name = signal('');
  readonly baseUrl = signal('');
  readonly apiKey = signal('');
  readonly clearCredential = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly loading = signal(false);
  readonly busyId = signal('');
  readonly formError = signal('');
  readonly loadError = signal('');
  readonly message = signal('');
  readonly models = signal<ProviderModel[]>([]);
  readonly modelsLoaded = signal(false);

  constructor(private readonly providers: ProviderConnectionsService) {}

  ngOnInit() { void this.load(); }

  storageAvailable() { return this.secureStorage().available; }
  storageReason() {
    return this.secureStorage().reason || 'No supported OS credential store is available in this session.';
  }
  credentialConfigured() {
    return this.connections().some(connection => connection.id === this.editingId() && connection.credential_configured);
  }

  async load() {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const response = await this.providers.list();
      this.connections.set(response.data?.connections ?? []);
      this.secureStorage.set(response.data?.secure_storage ?? { available: false, reason: 'The local API did not report secure credential storage.' });
    } catch (error) {
      this.loadError.set(readableError(error));
      this.secureStorage.set({ available: false, reason: 'The local API could not confirm secure credential storage.' });
    } finally {
      this.loading.set(false);
    }
  }

  edit(connection: ProviderConnection) {
    this.editingId.set(connection.id);
    this.name.set(connection.name);
    this.baseUrl.set(connection.base_url);
    this.apiKey.set('');
    this.clearCredential.set(false);
    this.formError.set('');
    this.message.set('');
    this.models.set([]);
    this.modelsLoaded.set(false);
  }

  resetForm() {
    this.editingId.set(null);
    this.name.set('');
    this.baseUrl.set('');
    this.apiKey.set('');
    this.clearCredential.set(false);
    this.formError.set('');
  }

  async save(event: Event) {
    event.preventDefault();
    this.formError.set('');
    this.message.set('');
    const name = this.name().trim();
    const baseUrl = this.baseUrl().trim();
    const editingId = this.editingId();
    if (!name || name.length > 80) { this.formError.set('Enter a connection name between 1 and 80 characters.'); return; }
    const urlError = validateProviderUrl(baseUrl);
    if (urlError) { this.formError.set(urlError); return; }
    const key = this.apiKey();
    if (!editingId && !key) { this.formError.set('Enter an API key to create an enabled provider connection.'); return; }
    if (key && !this.storageAvailable()) { this.formError.set('Secure credential storage is unavailable. Configure the OS keyring before saving an API key.'); return; }
    if (key.length > 4096 || key.includes('\0')) { this.formError.set('The API key must be at most 4096 characters.'); return; }
    this.saving.set(true);
    try {
      if (editingId) {
        const update: { name: string; base_url: string; api_key?: string; clear_api_key?: boolean } = { name, base_url: baseUrl };
        if (this.clearCredential()) update.clear_api_key = true;
        else if (key) update.api_key = key;
        const response = await this.providers.update(editingId, update);
        this.providers.forgetConnectionModels(editingId);
        this.message.set(`Connection “${response.data?.connection.name ?? name}” saved.`);
      } else {
        const response = await this.providers.create({ name, base_url: baseUrl, api_key: key, enabled: false });
        this.message.set(`Connection “${response.data?.connection.name ?? name}” saved securely. Enable it when ready.`);
      }
      this.apiKey.set('');
      this.resetForm();
      await this.load();
    } catch (error) {
      this.formError.set(readableError(error));
    } finally {
      this.saving.set(false);
    }
  }

  async setEnabled(connection: ProviderConnection, enabled: boolean) {
    this.message.set('');
    if (enabled && (!this.storageAvailable() || !connection.credential_configured)) {
      this.message.set(!this.storageAvailable() ? 'Unlock secure credential storage before enabling a provider.' : 'Edit this connection and save an API key before enabling it.');
      return;
    }
    this.busyId.set(connection.id);
    try {
      await this.providers.update(connection.id, { enabled });
      if (!enabled) this.providers.forgetConnectionModels(connection.id);
      this.message.set(enabled ? `${connection.name} enabled.` : `${connection.name} disabled.`);
      await this.load();
    } catch (error) {
      this.loadError.set(readableError(error));
    } finally {
      this.busyId.set('');
    }
  }

  async test(connection: ProviderConnection) {
    this.message.set('');
    this.loadError.set('');
    this.busyId.set(connection.id);
    try {
      const response = await this.providers.test(connection.id);
      this.message.set(`${connection.name} responded; ${response.data?.model_count ?? 0} models discovered.`);
    } catch (error) {
      this.loadError.set(readableError(error));
    } finally {
      this.busyId.set('');
    }
  }

  async discover(connection: ProviderConnection) {
    this.message.set('');
    this.loadError.set('');
    this.busyId.set(connection.id);
    this.models.set([]);
    this.modelsLoaded.set(false);
    try {
      const response = await this.providers.models(connection.id);
      this.models.set(response.data?.models ?? []);
      this.providers.rememberDiscoveredModels(connection.id, response.data?.models ?? []);
      this.modelsLoaded.set(true);
      this.message.set(`${connection.name}: remote model list refreshed.`);
    } catch (error) {
      this.loadError.set(readableError(error));
    } finally {
      this.busyId.set('');
    }
  }

  clearModels() {
    this.models.set([]);
    this.modelsLoaded.set(false);
    this.providers.clearDiscoveredModels();
  }

  async remove(connection: ProviderConnection) {
    this.message.set('');
    this.loadError.set('');
    this.busyId.set(connection.id);
    try {
      await this.providers.delete(connection.id);
      this.providers.forgetConnectionModels(connection.id);
      if (this.editingId() === connection.id) this.resetForm();
      this.models.set(this.models().filter(model => model.connection_id !== connection.id));
      this.message.set(`${connection.name} removed.`);
      await this.load();
    } catch (error) {
      this.loadError.set(readableError(error));
    } finally {
      this.busyId.set('');
    }
  }
}

function validateProviderUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { return 'Enter a valid provider base URL.'; }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '::1';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return 'Use an HTTP(S) base URL without credentials, query parameters, or fragments.';
  }
  if (url.protocol !== 'https:' && !loopback) return 'External provider URLs must use HTTPS. HTTP is allowed only for loopback services.';
  if (!url.port && url.protocol === 'http:') return 'Loopback HTTP URLs must include an explicit port.';
  if (hostname.length > 253 || /[\s\\%]/.test(hostname)) return 'The provider host is invalid.';
  return '';
}

function readableError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (body && typeof body === 'object' && typeof body.error === 'string') return body.error;
    if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
  }
  return error instanceof Error ? error.message : String(error);
}
