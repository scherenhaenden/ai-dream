import React, { useState } from 'react';

const sampleDocuments = [
  { name: 'runtime-notes.md', type: 'text/markdown', characters: '12,480', size: '18 KB', date: 'Example entry' },
  { name: 'hardware-guide.pdf', type: 'application/pdf', characters: '8,216', size: '640 KB', date: 'Example entry' },
  { name: 'api-reference.txt', type: 'text/plain', characters: '3,102', size: '6 KB', date: 'Example entry' },
];

export const KnowledgeRAGScreen: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('SQLite full-text search');
  const [searched, setSearched] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      showToast('Enter words to search the local full-text index.');
      return;
    }
    setSearched(true);
    showToast('Prototype preview only: no live index was queried.');
  };

  return (
    <section className="flex flex-col w-full max-w-6xl mx-auto text-on-surface p-4 sm:p-6 space-y-5">
      {toastMessage && (
        <div role="status" aria-live="polite" className="fixed bottom-12 right-4 sm:right-6 z-50 max-w-[calc(100vw-2rem)] px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl text-[12px] font-mono">
          {toastMessage}
        </div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[11px] text-outline uppercase">Library / Local search</div>
          <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">Knowledge</h1>
          <p className="text-[13px] text-on-surface-variant max-w-2xl leading-relaxed">
            Search indexed local documents with SQLite FTS5 lexical full-text matching. Search matches words in the text; it does not find related concepts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => showToast('Prototype preview only: document upload is not connected here.')}
          className="shrink-0 flex items-center justify-center gap-1.5 px-3 min-h-9 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-semibold rounded-lg border border-outline-variant/30"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">upload_file</span>
          Add document
        </button>
      </header>

      <aside aria-label="Prototype data notice" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 rounded-lg border border-secondary/30 bg-secondary-container/10 text-[12px]">
        <div className="flex items-center gap-2 text-secondary font-semibold">
          <span aria-hidden="true" className="material-symbols-outlined text-[17px]">info</span>
          Prototype data — no live index is loaded
        </div>
        <span className="text-on-surface-variant">The documents and search examples below are illustrative.</span>
      </aside>

      <section aria-labelledby="search-heading" className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 sm:p-5 space-y-3">
        <div>
          <h2 id="search-heading" className="text-[15px] font-semibold">Search indexed text</h2>
          <p className="mt-1 text-[12px] text-on-surface-variant">Local SQLite FTS5 · lexical term matching · up to 16 query words</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor="knowledge-search">Words to find in indexed documents</label>
          <input
            id="knowledge-search"
            className="min-w-0 flex-1 bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-[13px] px-3 py-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary font-sans"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleSearch(); }}
            maxLength={256}
            placeholder="Enter words to match"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="flex items-center justify-center gap-1.5 px-4 min-h-10 bg-primary text-on-primary text-[12px] font-semibold rounded-lg hover:bg-primary-fixed-dim"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">search</span>
            Search
          </button>
        </div>
        {searched && (
          <div aria-live="polite" className="space-y-2 pt-1">
            <p className="font-mono text-[11px] text-on-surface-variant">Illustrative lexical matches for “{searchQuery.trim()}”</p>
            <article className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 space-y-1">
              <h3 className="text-[12px] font-semibold">runtime-notes.md <span className="font-normal text-outline">· example result</span></h3>
              <p className="text-[12px] text-on-surface-variant leading-relaxed">“The local document index uses SQLite FTS5 to match words in extracted text.”</p>
            </article>
          </div>
        )}
        <p className="text-[11px] text-outline">No embeddings or semantic search. Search cannot infer meaning or match synonyms unless those words appear in the indexed text.</p>
      </section>

      <section aria-labelledby="documents-heading" className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-outline-variant/20 pb-3">
          <div>
            <h2 id="documents-heading" className="text-[15px] font-semibold">Indexed documents</h2>
            <p className="mt-1 text-[11px] text-outline">Example list · actual documents are managed by the local application API.</p>
          </div>
          <span className="font-mono text-[10px] text-on-surface-variant">TXT · Markdown · text-based PDF</span>
        </div>
        <ul className="divide-y divide-outline-variant/20">
          {sampleDocuments.map((document) => (
            <li key={document.name} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3">
              <div className="flex items-start gap-3 min-w-0">
                <span aria-hidden="true" className="material-symbols-outlined text-primary text-[19px]">description</span>
                <div className="min-w-0">
                  <h3 className="text-[12px] font-semibold break-all">{document.name}</h3>
                  <p className="text-[10px] text-outline">{document.type} · {document.characters} characters · {document.size}</p>
                </div>
              </div>
              <span className="font-mono text-[10px] text-outline sm:text-right">{document.date}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-on-surface-variant leading-relaxed">
          Limits: 5 MiB per file, 40,000 extracted characters per document, 80,000 total indexed characters, and 100 documents. Scanned PDFs are not OCR-processed, so their images are not searchable.
        </p>
      </section>
    </section>
  );
};
