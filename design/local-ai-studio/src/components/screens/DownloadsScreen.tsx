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
    <div className="flex-1 flex flex-col h-full bg-surface-container-lowest overflow-y-auto p-6 space-y-6">
      <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
        Static reference · every transfer, path, speed, ETA and checksum below is sample data. This screen does not connect to the download service.
      </div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">download</span>
            Downloads · sample queue
          </h1>
          <p className="text-xs text-on-surface-variant mt-1 font-mono">
            Illustrative transfer states only. Production downloads are started from Model Hubs and appear here when connected to the local service.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button disabled title="Preview only · start downloads from the connected Model Hubs flow"
            className="px-4 py-2 bg-primary hover:bg-primary-fixed-dim text-on-primary rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">add_link</span>
            Add Download URL
          </button>
        </div>
      </div>

      {/* Add URL Drawer */}
      {isAdding && (
        <form onSubmit={(e) => e.preventDefault()} className="bg-surface-container-low border border-outline-variant p-4 rounded-xl space-y-3">
          <label className="text-xs font-bold text-on-surface font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">link</span>
            Direct Model GGUF / SafeTensors URL
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={urlInput}
              disabled
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://huggingface.co/Qwen/Qwen3.8-27B-Instruct-GGUF/resolve/main/qwen3.8-27b-instruct-q4_k_m.gguf"
              className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled
              title="Preview only · transfers cannot be started here"
              className="px-4 py-2 bg-primary hover:bg-primary-fixed-dim text-on-primary rounded-lg text-xs font-bold"
            >
              Start Download
            </button>
          </div>
        </form>
      )}

      {/* Speed & Storage Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-low border border-outline-variant p-4 rounded-xl">
          <div className="text-[10px] text-on-surface-variant font-mono uppercase">Sample aggregate speed</div>
          <div className="text-2xl font-bold font-mono text-tertiary mt-1">84.6 MB/s</div>
          <div className="text-xs text-on-surface-variant mt-1 font-mono">Example only · concurrency is not reported here</div>
        </div>

        <div className="bg-surface-container-low border border-outline-variant p-4 rounded-xl">
          <div className="text-[10px] text-on-surface-variant font-mono uppercase">Example destination path</div>
          <div className="text-2xl font-bold font-mono text-on-surface mt-1">/mnt/fast_nvme/</div>
          <div className="text-xs text-on-surface-variant mt-1 font-mono">Sample value · disk capacity is not reported here</div>
        </div>

        <div className="bg-surface-container-low border border-outline-variant p-4 rounded-xl">
          <div className="text-[10px] text-on-surface-variant font-mono uppercase">Checksum Pipeline</div>
          <div className="text-2xl font-bold font-mono text-primary mt-1">Sample checksum state</div>
          <div className="text-xs text-on-surface-variant mt-1 font-mono">Checksum capability is not reported by the current contract</div>
        </div>
      </div>

      {/* Jobs List */}
      <div className="space-y-4">
        {jobs.map((job) => {
          const pct = Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100));
          return (
            <div key={job.id} className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-on-surface">{job.filename}</span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                        job.status === 'DOWNLOADING'
                          ? 'bg-primary-container/10 text-primary border border-primary/20'
                          : job.status === 'COMPLETED'
                          ? 'bg-tertiary/10 text-tertiary border border-tertiary/20'
                          : 'bg-warning/10 text-warning border border-warning/20'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono truncate max-w-xl mt-1">{job.source}</div>
                </div>

                <div className="flex items-center gap-3">
                  {job.status !== 'COMPLETED' && (
                    <button disabled title="Preview only · live queue supports cancellation, not pause/resume"
                      className="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant rounded-lg text-xs font-mono text-on-surface flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm" aria-hidden="true">
                        {job.status === 'DOWNLOADING' ? 'pause' : 'play_arrow'}
                      </span>
                      {job.status === 'DOWNLOADING' ? 'Pause' : 'Resume'}
                    </button>
                  )}
                  {job.status === 'COMPLETED' && (
                    <span className="text-xs font-mono text-tertiary flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm" aria-hidden="true">verified</span>
                      Example checksum label
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full bg-surface-container-low rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      job.status === 'COMPLETED'
                        ? 'bg-tertiary'
                        : job.status === 'PAUSED'
                        ? 'bg-warning'
                        : 'bg-primary-container'
                    }`}
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[11px] font-mono text-on-surface-variant">
                  <span>
                    {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)} ({pct}%)
                  </span>
                  <span>
                    {job.status === 'DOWNLOADING'
                      ? `${job.speedMBs.toFixed(1)} MB/s • ETA ${job.etaSeconds}s`
                      : job.status === 'COMPLETED'
                      ? 'Example completed state · not verified on this device'
                      : 'Suspended'}
                  </span>
                </div>
              </div>

              {/* Destination & Hash */}
              <div className="text-[11px] font-mono text-on-surface-variant bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant flex flex-col md:flex-row justify-between gap-1">
                <div className="truncate">
                  <span className="text-primary">Path:</span> {job.destination}
                </div>
                <div className="truncate text-right">
                  <span className="text-primary">SHA256:</span> {job.sha256Expected.slice(0, 16)}...
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
