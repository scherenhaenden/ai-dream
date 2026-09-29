import React, { useState, useEffect } from 'react';

export const LocalApiServerScreen: React.FC = () => {
  const [isRunning, setIsRunning] = useState(true);
  const [throughput, setThroughput] = useState(42.4);
  const [lanExposed, setLanExposed] = useState(false);
  const [requireKey, setRequireKey] = useState(true);
  const [apiKey, setApiKey] = useState('sk-local-ai-studio-9f82d1ab');
  const [corsOrigins, setCorsOrigins] = useState('http://localhost:3000, vscode-webview://*, http://127.0.0.1:8080');
  const [snippetTab, setSnippetTab] = useState<'python' | 'curl' | 'node' | 'continue'>('python');
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [traces, setTraces] = useState([
    {
      time: '15:42:01.428',
      verb: 'POST',
      path: '/v1/chat/completions',
      status: '200 SSE',
      ttft: '38ms',
      promptTok: '1,248',
      compTok: '412',
      speed: '42.4 tok/s',
      client: '127.0.0.1:58432',
    },
    {
      time: '15:41:58.112',
      verb: 'GET',
      path: '/v1/models',
      status: '200 OK',
      ttft: '4ms',
      promptTok: '—',
      compTok: '—',
      speed: '—',
      client: '172.17.0.2:48992',
    },
    {
      time: '15:41:30.984',
      verb: 'POST',
      path: '/v1/embeddings',
      status: '200 OK',
      ttft: '12ms',
      promptTok: '64',
      compTok: '[1024d]',
      speed: '890 tok/s',
      client: '127.0.0.1:58432',
    },
    {
      time: '15:40:12.605',
      verb: 'POST',
      path: '/v1/chat/completions',
      status: '200 SSE',
      ttft: '42ms',
      promptTok: '3,890',
      compTok: '1,820',
      speed: '41.8 tok/s',
      client: '127.0.0.1:54120',
    },
    {
      time: '15:39:44.219',
      verb: 'POST',
      path: '/v1/completions',
      status: '200 OK',
      ttft: '31ms',
      promptTok: '128',
      compTok: '64',
      speed: '43.2 tok/s',
      client: '127.0.0.1:54120',
    },
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Subtle throughput jitter
  useEffect(() => {
    const interval = setInterval(() => {
      if (isRunning && isLiveStreaming) {
        setThroughput(+(42 + Math.random() * 2).toFixed(1));
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [isRunning, isLiveStreaming]);

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
    showToast('Copied API key to clipboard');
  };

  const regenerateKey = () => {
    const hex = Math.random().toString(16).substring(2, 10);
    const newKey = `sk-local-ai-studio-${hex}`;
    setApiKey(newKey);
    showToast(`Regenerated key: ${newKey}`);
  };

  const snippets = {
    python: `from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:5200/v1",
    api_key="${apiKey}"
)

stream = client.chat.completions.create(
    model="Qwen3.8-27B-Instruct",
    messages=[{"role": "user", "content": "Optimize ROCm kernel for dual GPU"}],
    temperature=0.3,
    stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
    curl: `curl http://127.0.0.1:5200/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "Qwen3.8-27B-Instruct",
    "messages": [{"role": "user", "content": "Explain KV cache quantization"}],
    "stream": true,
    "max_tokens": 512
  }'`,
    node: `import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:5200/v1',
  apiKey: '${apiKey}',
});

const response = await openai.chat.completions.create({
  model: 'Qwen3.8-27B-Instruct',
  messages: [{ role: 'user', content: 'Generate TS typings for API schema' }],
});
console.log(response.choices[0].message.content);`,
    continue: `// ~/.continue/config.json or Cursor Local AI settings
{
  "models": [
    {
      "title": "Local AI Studio (Qwen3.8-27B)",
      "provider": "openai",
      "model": "Qwen3.8-27B-Instruct",
      "apiBase": "http://127.0.0.1:5200/v1",
      "apiKey": "${apiKey}"
    }
  ]
}`,
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none pb-12 p-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl flex items-center gap-2 text-[12px] font-mono animate-bounce">
          <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Hero Header & Key Operational Metas */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-5 rounded-xl bg-surface-container border border-outline-variant/30 shadow-md relative overflow-hidden">
        <div className="flex flex-col space-y-1 relative z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">Local API Server</h1>
            <span className="px-2 py-0.5 rounded bg-surface-container-high font-mono text-[11px] text-primary font-semibold border border-outline-variant/30">
              OpenAI Compatible
            </span>
            <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-tertiary-container/20 text-tertiary border border-tertiary/30">
              <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
              <span className="font-mono text-[11px] font-semibold tracking-wide">
                {isRunning ? 'RUNNING · http://127.0.0.1:5200/v1' : 'STOPPED'}
              </span>
            </div>
          </div>
          <p className="text-[13px] text-on-surface-variant max-w-2xl leading-relaxed">
            High-performance local inference gateway mapping native{' '}
            <span className="font-mono text-[12px] text-on-surface">llama.cpp</span> runtime to standard
            OpenAI endpoints. Compatible with Cursor, VS Code, Continue.dev, LangChain, and OpenAI SDKs.
          </p>
        </div>

        {/* Telemetry Badges */}
        <div className="flex items-center gap-3 shrink-0 relative z-10">
          <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col items-end min-w-[120px] shadow-sm font-mono">
            <span className="text-[10px] text-outline uppercase tracking-wider">Throughput</span>
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold text-tertiary">{throughput}</span>
              <span className="text-[10px] text-tertiary-fixed-dim">tok/s</span>
            </div>
            <div className="w-full h-1 bg-surface-container-high rounded overflow-hidden mt-1">
              <div className="h-full bg-tertiary rounded" style={{ width: '71%' }}></div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col items-end min-w-[110px] shadow-sm font-mono">
            <span className="text-[10px] text-outline uppercase tracking-wider">Queue Latency</span>
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold text-primary">18.2</span>
              <span className="text-[10px] text-primary-fixed-dim">ms</span>
            </div>
            <span className="text-[10px] text-tertiary mt-0.5">0 pending</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col items-end min-w-[110px] shadow-sm font-mono">
            <span className="text-[10px] text-outline uppercase tracking-wider">Concur. Streams</span>
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold text-on-surface">3</span>
              <span className="text-[10px] text-outline">/ 8 max</span>
            </div>
            <span className="text-[10px] text-on-surface-variant mt-0.5">PagedKV active</span>
          </div>
        </div>
      </div>

      {/* Control Bar & Runtime Status Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
          <button
            onClick={() => {
              setIsRunning(!isRunning);
              showToast(isRunning ? 'API Gateway Daemon stopped' : 'API Gateway Daemon resumed on port 5200');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors border shadow-sm cursor-pointer ${
              isRunning
                ? 'bg-surface-container-high text-error hover:bg-error-container hover:text-on-error-container border-error/30'
                : 'bg-primary text-on-primary hover:bg-primary-fixed-dim border-primary/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            <span>{isRunning ? 'Stop Server' : 'Start Server'}</span>
          </button>

          <button
            onClick={() => showToast('Restarted HTTP/SSE listener on :5200')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface hover:text-primary transition-colors border border-outline-variant/30 shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">replay</span>
            <span>Restart</span>
          </button>

          <button
            onClick={() => showToast('Model weight layers re-synchronized in VRAM')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface hover:text-primary transition-colors border border-outline-variant/30 shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">sync_saved_locally</span>
            <span>Reload Weights</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-highest border border-outline-variant/20 text-on-surface">
            <span className="text-outline">PORT:</span>
            <span className="text-primary font-semibold">5200</span>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-highest border border-outline-variant/20 text-on-surface">
            <span className="text-outline">MODEL:</span>
            <span className="text-on-surface font-semibold truncate max-w-[190px]">
              Qwen3.8-27B-Instruct (Q4_K_M)
            </span>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-highest border border-outline-variant/20 text-on-surface">
            <span className="text-outline">BACKEND:</span>
            <span className="text-tertiary">llama.cpp Vulkan (2 GPUs)</span>
          </div>
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors ${
              lanExposed
                ? 'bg-error-container/20 text-error border-error/30 font-semibold'
                : 'bg-surface-container-highest text-on-surface-variant border-outline-variant/20'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${lanExposed ? 'bg-error animate-pulse' : 'bg-outline'}`}></span>
            <span>{lanExposed ? 'LAN: 192.168.1.140:5200' : 'LAN: Localhost Only'}</span>
          </div>
        </div>
      </div>

      {/* Grid: Config (5 cols) vs Integration Recipes & Sessions (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          {/* Configuration & Security Card */}
          <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-1 border-b border-outline-variant/20">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
                <h2 className="text-[15px] font-semibold text-on-surface">Configuration &amp; Security</h2>
              </div>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-outline">
                v1.6 Config
              </span>
            </div>

            {/* Network Interface Binding */}
            <div className="space-y-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-on-surface">Network Interface Binding</div>
                  <div className="text-[11px] text-on-surface-variant">Restricts host ingress sockets</div>
                </div>
                <span
                  className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                    lanExposed
                      ? 'bg-error-container/20 text-error border-error/30 font-semibold'
                      : 'bg-surface-container text-primary border-outline-variant/20'
                  }`}
                >
                  {lanExposed ? '0.0.0.0 (LAN exposed)' : '127.0.0.1'}
                </span>
              </div>

              <div className="pt-1 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    checked={lanExposed}
                    onChange={(e) => {
                      setLanExposed(e.target.checked);
                      showToast(
                        e.target.checked
                          ? 'Warning: Exposed to local subnet (192.168.1.140)'
                          : 'Re-bound strictly to 127.0.0.1'
                      );
                    }}
                    className="sr-only peer"
                    type="checkbox"
                  />
                  <div className="w-9 h-5 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  <span className="text-[12px] text-on-surface">Expose to Local Network (LAN)</span>
                </label>
                <span className="font-mono text-[11px] text-outline">192.168.1.140</span>
              </div>

              {lanExposed && (
                <div className="mt-2 p-2.5 rounded bg-error-container/20 border border-error/30 text-on-error-container space-y-1">
                  <div className="flex items-center gap-1.5 text-error font-semibold text-[11px] font-mono">
                    <span className="material-symbols-outlined text-[16px]">warning</span>
                    <span>LAN Ingress Exposure Active</span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-tight">
                    Other devices on subnet <code className="text-on-surface font-mono">192.168.1.0/24</code> can trigger compute jobs and consume local GPU VRAM. Ensure API Key enforcement is activated.
                  </p>
                </div>
              )}
            </div>

            {/* Port & Batch Tokens */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-mono text-[10px] text-outline uppercase tracking-wider block">
                  Port Setting
                </label>
                <div className="relative">
                  <input
                    defaultValue={5200}
                    className="w-full h-8 px-3 bg-surface-container-low font-mono text-[12px] text-on-surface rounded-lg border border-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-primary"
                    type="number"
                  />
                  <span className="absolute right-2.5 top-2 text-outline font-mono text-[10px]">TCP</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[10px] text-outline uppercase tracking-wider block">
                  Max Batch Tokens
                </label>
                <div className="relative">
                  <input
                    readOnly
                    defaultValue="4096 ctx"
                    className="w-full h-8 px-3 bg-surface-container-low font-mono text-[12px] text-on-surface-variant rounded-lg border border-outline-variant/30"
                    type="text"
                  />
                  <span className="material-symbols-outlined absolute right-2.5 top-2 text-outline text-[16px]">
                    lock
                  </span>
                </div>
              </div>
            </div>

            {/* API Key Management */}
            <div className="space-y-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-on-surface">Require API Key</div>
                  <div className="text-[11px] text-on-surface-variant">Inspects 'Authorization: Bearer' headers</div>
                </div>
                <label className="flex items-center cursor-pointer select-none">
                  <input
                    checked={requireKey}
                    onChange={(e) => {
                      setRequireKey(e.target.checked);
                      showToast(e.target.checked ? 'API key enforcement enabled' : 'Warning: API key disabled');
                    }}
                    className="sr-only peer"
                    type="checkbox"
                  />
                  <div className="w-9 h-5 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="space-y-1 pt-1">
                <span className="font-mono text-[10px] text-outline">Master Secret Key</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-8 px-3 bg-surface-container border border-outline-variant/30 flex items-center justify-between rounded font-mono text-[11px] text-primary overflow-hidden">
                    <span className="truncate">{apiKey}</span>
                    <span className="text-tertiary text-[9px] uppercase font-bold tracking-wider ml-1">
                      VALID
                    </span>
                  </div>
                  <button
                    onClick={copyApiKey}
                    className="h-8 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors flex items-center justify-center border border-outline-variant/30"
                    title="Copy Key"
                  >
                    <span className="material-symbols-outlined text-[15px]">content_copy</span>
                  </button>
                  <button
                    onClick={regenerateKey}
                    className="h-8 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors flex items-center justify-center border border-outline-variant/30"
                    title="Regenerate Key"
                  >
                    <span className="material-symbols-outlined text-[15px]">autorenew</span>
                  </button>
                </div>
              </div>
            </div>

            {/* CORS Origins */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10px] text-outline uppercase tracking-wider">
                  Allowed CORS Origins
                </label>
                <button
                  onClick={() => {
                    setCorsOrigins('http://localhost:3000, vscode-webview://*, http://127.0.0.1:8080');
                    showToast('CORS origins reset to defaults');
                  }}
                  className="font-mono text-[10px] text-primary hover:underline"
                >
                  Reset Default
                </button>
              </div>
              <textarea
                className="w-full p-2 bg-surface-container-low border border-outline-variant/30 font-mono text-[11px] text-on-surface rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                rows={2}
                value={corsOrigins}
                onChange={(e) => setCorsOrigins(e.target.value)}
              />
              <div className="flex items-center gap-1 text-outline font-mono text-[10px]">
                <span className="material-symbols-outlined text-[13px]">shield</span>
                <span>Allows local web IDE sandboxes and containerized frontends</span>
              </div>
            </div>
          </div>

          {/* Supported Endpoints Table */}
          <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">hub</span>
                <h3 className="text-[14px] font-semibold text-on-surface">Supported Endpoints</h3>
              </div>
              <span className="font-mono text-[11px] text-tertiary">4 Live Endpoints</span>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-secondary-container/30 text-secondary font-bold text-[10px]">
                    GET
                  </span>
                  <span className="text-on-surface font-semibold truncate">/v1/models</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-outline">OpenAI JSON</span>
                  <span className="px-1.5 py-0.2 rounded bg-tertiary/10 text-tertiary font-semibold">200 OK</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-primary-container/30 text-primary font-bold text-[10px]">
                    POST
                  </span>
                  <span className="text-on-surface font-semibold truncate">/v1/chat/completions</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary font-mono">SSE Stream</span>
                  <span className="px-1.5 py-0.2 rounded bg-tertiary/10 text-tertiary font-semibold">Ready</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-primary-container/30 text-primary font-bold text-[10px]">
                    POST
                  </span>
                  <span className="text-on-surface font-semibold truncate">/v1/completions</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-outline">Legacy SDK</span>
                  <span className="px-1.5 py-0.2 rounded bg-surface-container text-on-surface-variant">Active</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-primary-container/30 text-primary font-bold text-[10px]">
                    POST
                  </span>
                  <span className="text-on-surface font-semibold truncate">/v1/embeddings</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-outline">e5-large (1024d)</span>
                  <span className="px-1.5 py-0.2 rounded bg-tertiary/10 text-tertiary font-semibold">Bound</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): Connection Recipes & Connected Sessions */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Connection Recipes Deck */}
          <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-3 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">code</span>
                <h2 className="text-[15px] font-semibold text-on-surface">Client Connection Recipes</h2>
              </div>
              <div className="flex items-center bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant/30 font-mono text-[11px]">
                {(
                  [
                    { id: 'python', label: 'Python (OpenAI SDK)' },
                    { id: 'curl', label: 'cURL' },
                    { id: 'node', label: 'JavaScript / TS' },
                    { id: 'continue', label: 'Continue / Cursor' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSnippetTab(tab.id)}
                    className={`px-3 py-1 rounded transition-colors ${
                      snippetTab === tab.id
                        ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                        : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Code Box */}
            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4 font-mono text-[11.5px] space-y-2">
              <div className="flex items-center justify-between pb-1 border-b border-outline-variant/10 text-[10px] text-outline">
                <span>
                  {snippetTab === 'python'
                    ? 'Python Official SDK — Zero modification required'
                    : snippetTab === 'curl'
                    ? 'Direct terminal cURL query with streaming headers'
                    : snippetTab === 'node'
                    ? 'TypeScript / Node OpenAI npm package'
                    : 'Drop-in JSON stanza for Cursor or Continue.dev'}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(snippets[snippetTab]);
                    showToast('Snippet copied to clipboard');
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface text-primary transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">file_copy</span>
                  <span>Copy snippet</span>
                </button>
              </div>

              <pre className="overflow-x-auto text-on-surface font-mono leading-relaxed py-1">
                <code>{snippets[snippetTab]}</code>
              </pre>
            </div>
          </div>

          {/* Connected Clients & Sessions Monitor */}
          <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary text-[20px]">devices</span>
                <h3 className="text-[15px] font-semibold text-on-surface">Connected Clients &amp; Sessions</h3>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-outline">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                <span>3 Inbound Peers</span>
              </div>
            </div>

            <div className="space-y-2 font-mono text-[11px]">
              {/* Session 1 */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[20px]">terminal</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-on-surface truncate">
                        VS Code Continue Extension
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-tertiary/10 text-tertiary font-bold text-[9px]">
                        STREAMING
                      </span>
                    </div>
                    <span className="text-[10px] text-outline truncate block">
                      127.0.0.1 • Agent ID: continue-worker-01 • Last req: 2s ago
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-tertiary font-bold">18.4 tok/s</div>
                    <div className="text-[9px] text-outline">Active Chunking</div>
                  </div>
                  <button
                    onClick={() => showToast('Disconnected Continue socket session')}
                    className="p-1 text-outline hover:text-error transition-colors"
                    title="Disconnect"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              </div>

              {/* Session 2 */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-center text-secondary shrink-0">
                    <span className="material-symbols-outlined text-[20px]">web</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-on-surface truncate">
                        Open WebUI (Docker Bridge)
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-surface-container-highest text-on-surface-variant text-[9px]">
                        IDLE
                      </span>
                    </div>
                    <span className="text-[10px] text-outline truncate block">
                      172.17.0.2:48992 • Keepalive Ping • Last req: 4m ago
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-on-surface font-medium">0 tok/s</div>
                    <div className="text-[9px] text-outline">Session Standby</div>
                  </div>
                  <button
                    onClick={() => showToast('Disconnected Open WebUI session')}
                    className="p-1 text-outline hover:text-error transition-colors"
                    title="Disconnect"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              </div>

              {/* Session 3 */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-center text-tertiary shrink-0">
                    <span className="material-symbols-outlined text-[20px]">code_blocks</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-on-surface truncate">
                        Python Script bench.py
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-surface-container-highest text-outline text-[9px]">
                        COMPLETED
                      </span>
                    </div>
                    <span className="text-[10px] text-outline truncate block">
                      127.0.0.1:54120 • Process PID: 8812 • Last req: 8m ago
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-on-surface">2,410 tokens</div>
                    <div className="text-[9px] text-tertiary font-bold">avg 44.1 tok/s</div>
                  </div>
                  <button
                    onClick={() => showToast('Removed session bench.py')}
                    className="p-1 text-outline hover:text-error transition-colors"
                    title="Disconnect"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Ingress Request Trace Stream */}
      <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-3 shadow-md">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">monitoring</span>
            <h3 className="text-[15px] font-semibold text-on-surface">Live Ingress Request Trace Stream</h3>
            <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-tertiary font-mono text-[10px]">
              100ms Sampling
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <button
              onClick={() => {
                setTraces([]);
                showToast('Trace buffer cleared');
              }}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface border border-outline-variant/30 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
              <span>Clear Buffer</span>
            </button>
            <button
              onClick={() => {
                setIsLiveStreaming(!isLiveStreaming);
                showToast(isLiveStreaming ? 'Paused live trace stream' : 'Resumed live trace stream');
              }}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface border border-outline-variant/30 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">
                {isLiveStreaming ? 'pause' : 'play_arrow'}
              </span>
              <span>{isLiveStreaming ? 'Live Stream' : 'Paused'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-3 font-mono text-[11px] overflow-x-auto shadow-inner">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-outline uppercase text-[10px] tracking-wider border-b border-outline-variant/20 pb-1">
                <th className="py-2 px-2 font-semibold">Timestamp</th>
                <th className="py-2 px-2 font-semibold">Verb</th>
                <th className="py-2 px-2 font-semibold">Path Endpoint</th>
                <th className="py-2 px-2 font-semibold">Status</th>
                <th className="py-2 px-2 font-semibold text-right">TTFT</th>
                <th className="py-2 px-2 font-semibold text-right">Prompt Tok</th>
                <th className="py-2 px-2 font-semibold text-right">Comp Tok</th>
                <th className="py-2 px-2 font-semibold text-right">Speed</th>
                <th className="py-2 px-2 font-semibold text-right">Client IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10 text-on-surface">
              {traces.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-outline italic">
                    Trace buffer cleared. Waiting for inbound sockets...
                  </td>
                </tr>
              ) : (
                traces.map((t, idx) => (
                  <tr key={idx} className="hover:bg-surface-container/60 transition-colors">
                    <td className="py-2 px-2 text-outline">{t.time}</td>
                    <td className="py-2 px-2 font-bold text-primary">{t.verb}</td>
                    <td className="py-2 px-2 font-semibold text-on-surface">{t.path}</td>
                    <td className="py-2 px-2 text-tertiary">{t.status}</td>
                    <td className="py-2 px-2 text-right text-primary">{t.ttft}</td>
                    <td className="py-2 px-2 text-right text-on-surface-variant">{t.promptTok}</td>
                    <td className="py-2 px-2 text-right text-tertiary">{t.compTok}</td>
                    <td className="py-2 px-2 text-right text-tertiary font-bold">{t.speed}</td>
                    <td className="py-2 px-2 text-right text-outline">{t.client}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
