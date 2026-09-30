import React, { useState } from 'react';

interface DownloadJob {
  id: string;
  filename: string;
  source: string;
  totalBytes: number;
  downloadedBytes: number;
  speedMBs: number;
  status: 'DOWNLOADING' | 'PAUSED' | 'VERIFYING_SHA256' | 'COMPLETED' | 'ERROR';
  etaSeconds: number;
  sha256Expected: string;
  destination: string;
}

export const DownloadsScreen: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [jobs, setJobs] = useState<DownloadJob[]>([
    {
      id: 'job-1',
      filename: 'Qwen3.8-27B-Instruct-Q4_K_M.gguf',
      source: 'https://huggingface.co/Qwen/Qwen3.8-27B-Instruct-GGUF/resolve/main/qwen3.8-27b-instruct-q4_k_m.gguf',
      totalBytes: 16824900000,
      downloadedBytes: 11440932000,
      speedMBs: 84.6,
      status: 'DOWNLOADING',
      etaSeconds: 64,
      sha256Expected: '9a72df58319e078c1870bb80e9fbfa93e502847cba09951667b936d50ff6cb58',
      destination: '/mnt/fast_nvme/models/huggingface/Qwen3.8-27B-Instruct-Q4_K_M.gguf',
    },
    {
      id: 'job-2',
      filename: 'DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
      source: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
      totalBytes: 15300000000,
      downloadedBytes: 15300000000,
      speedMBs: 0,
      status: 'COMPLETED',
      etaSeconds: 0,
      sha256Expected: '4c43ee6180a525f2316e6f9ea2284e31e5bb876e6e2aa0adfe20014b2d30560a',
      destination: '/mnt/fast_nvme/models/huggingface/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
    },
    {
      id: 'job-3',
      filename: 'Llama-3.3-70B-Instruct-UD-IQ3_XXS.gguf',
      source: 'https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-UD-IQ3_XXS.gguf',
      totalBytes: 28400000000,
      downloadedBytes: 8400000000,
      speedMBs: 0,
      status: 'PAUSED',
      etaSeconds: 236,
      sha256Expected: '7b78912eefc4098901844917a86c6b24bb48fa440a7cf3901b0a889b9d332612',
      destination: '/mnt/fast_nvme/models/huggingface/Llama-3.3-70B-Instruct-UD-IQ3_XXS.gguf',
    },
  ]);

  const togglePause = (id: string) => {
    setJobs((prev) =>
      prev.map((job) => {
        if (job.id === id) {
          if (job.status === 'DOWNLOADING') {
            return { ...job, status: 'PAUSED', speedMBs: 0 };
          } else if (job.status === 'PAUSED') {
            return { ...job, status: 'DOWNLOADING', speedMBs: 76.2 };
          }
        }
        return job;
      }),
    );
  };

  const handleAddJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    const filename = urlInput.split('/').pop() || 'custom-model.gguf';
    const newJob: DownloadJob = {
      id: `job-${Date.now()}`,
      filename,
      source: urlInput.trim(),
      totalBytes: 8500000000,
      downloadedBytes: 100000000,
      speedMBs: 65.4,
      status: 'DOWNLOADING',
      etaSeconds: 128,
      sha256Expected: 'auto-verifying-from-hf-manifest',
      destination: `/mnt/fast_nvme/models/huggingface/${filename}`,
    };

    setJobs([newJob, ...jobs]);
    setUrlInput('');
    setIsAdding(false);
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--ds-surface-container-lowest)] overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--ds-outline-variant)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--ds-on-surface)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--ds-primary)]">download</span>
            Multi-Threaded Download Manager (aria2 Engine)
          </h1>
          <p className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-mono">
            Direct high-speed segment streaming with automatic SHA256 digest validation and instant indexing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-on-surface rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20"
          >
            <span className="material-symbols-outlined text-sm">add_link</span>
            Add Download URL
          </button>
        </div>
      </div>

      {/* Add URL Drawer */}
      {isAdding && (
        <form onSubmit={handleAddJob} className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-4 rounded-xl space-y-3">
          <label className="text-xs font-bold text-on-surface font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-[var(--ds-primary)]">link</span>
            Direct Model GGUF / SafeTensors URL
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://huggingface.co/Qwen/Qwen3.8-27B-Instruct-GGUF/resolve/main/qwen3.8-27b-instruct-q4_k_m.gguf"
              className="flex-1 bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-[var(--ds-primary)]"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-on-surface rounded-lg text-xs font-bold"
            >
              Start Download
            </button>
          </div>
        </form>
      )}

      {/* Speed & Storage Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-4 rounded-xl">
          <div className="text-[10px] text-[var(--ds-on-surface-variant)] font-mono uppercase">Current Aggregate Speed</div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">84.6 MB/s</div>
          <div className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-mono">16 TCP parallel segments per file</div>
        </div>

        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-4 rounded-xl">
          <div className="text-[10px] text-[var(--ds-on-surface-variant)] font-mono uppercase">Target Storage Partition</div>
          <div className="text-2xl font-bold font-mono text-on-surface mt-1">/mnt/fast_nvme/</div>
          <div className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-mono">1,124.0 GB free (PCIe Gen4 x4)</div>
        </div>

        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-4 rounded-xl">
          <div className="text-[10px] text-[var(--ds-on-surface-variant)] font-mono uppercase">Checksum Pipeline</div>
          <div className="text-2xl font-bold font-mono text-[var(--ds-primary)] mt-1">Hardware SHA256</div>
          <div className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-mono">AVX-512 accelerated verification</div>
        </div>
      </div>

      {/* Jobs List */}
      <div className="space-y-4">
        {jobs.map((job) => {
          const pct = Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100));
          return (
            <div key={job.id} className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-xl p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-on-surface">{job.filename}</span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                        job.status === 'DOWNLOADING'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          : job.status === 'COMPLETED'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--ds-on-surface-variant)] font-mono truncate max-w-xl mt-1">{job.source}</div>
                </div>

                <div className="flex items-center gap-3">
                  {job.status !== 'COMPLETED' && (
                    <button
                      onClick={() => togglePause(job.id)}
                      className="px-3 py-1.5 bg-[var(--ds-surface-container-low)] hover:bg-[var(--ds-surface-container-high)] border border-[var(--ds-outline-variant)] rounded-lg text-xs font-mono text-on-surface flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {job.status === 'DOWNLOADING' ? 'pause' : 'play_arrow'}
                      </span>
                      {job.status === 'DOWNLOADING' ? 'Pause' : 'Resume'}
                    </button>
                  )}
                  {job.status === 'COMPLETED' && (
                    <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">verified</span>
                      SHA256 Match
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full bg-[var(--ds-surface-container-low)] rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      job.status === 'COMPLETED'
                        ? 'bg-emerald-500'
                        : job.status === 'PAUSED'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[11px] font-mono text-[var(--ds-on-surface-variant)]">
                  <span>
                    {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)} ({pct}%)
                  </span>
                  <span>
                    {job.status === 'DOWNLOADING'
                      ? `${job.speedMBs.toFixed(1)} MB/s • ETA ${job.etaSeconds}s`
                      : job.status === 'COMPLETED'
                      ? 'Verified on Disk'
                      : 'Suspended'}
                  </span>
                </div>
              </div>

              {/* Destination & Hash */}
              <div className="text-[11px] font-mono text-[var(--ds-on-surface-variant)] bg-[var(--ds-surface-container-lowest)] p-2.5 rounded-lg border border-[var(--ds-outline-variant)] flex flex-col md:flex-row justify-between gap-1">
                <div className="truncate">
                  <span className="text-[var(--ds-primary)]">Path:</span> {job.destination}
                </div>
                <div className="truncate text-right">
                  <span className="text-[var(--ds-primary)]">SHA256:</span> {job.sha256Expected.slice(0, 16)}...
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
