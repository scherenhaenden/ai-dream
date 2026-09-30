import React, { useState, useEffect } from 'react';
import { ActiveScreen } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { CommandPaletteModal } from './components/CommandPaletteModal';

// Screens
import { ChatScreen } from './components/screens/ChatScreen';
import { ModelsLibraryScreen } from './components/screens/ModelsLibraryScreen';
import { ModelHubsScreen } from './components/screens/ModelHubsScreen';
import { HardwareTopologyScreen } from './components/screens/HardwareTopologyScreen';
import { LoadModelPlacementScreen } from './components/screens/LoadModelPlacementScreen';
import { ProvidersRuntimesScreen } from './components/screens/ProvidersRuntimesScreen';
import { LocalApiServerScreen } from './components/screens/LocalApiServerScreen';
import { KnowledgeRAGScreen } from './components/screens/KnowledgeRAGScreen';
import { ToolsSecurityScreen } from './components/screens/ToolsSecurityScreen';
import { DownloadsScreen } from './components/screens/DownloadsScreen';
import { LogsTracesScreen } from './components/screens/LogsTracesScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('chat');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Live telemetry state
  const [gpu0Usage, setGpu0Usage] = useState(74);
  const [gpu1Usage, setGpu1Usage] = useState(69);
  const [hostRamUsage, setHostRamUsage] = useState(44);

  // Loaded model state
  const [loadedModelName, setLoadedModelName] = useState('Qwen3.8-27B-Instruct (Q4_K_M)');
  const [notification, setNotification] = useState<string | null>(null);

  // Subtle fluctuation of live telemetry metrics
  useEffect(() => {
    const timer = setInterval(() => {
      setGpu0Usage(Math.floor(72 + Math.random() * 5));
      setGpu1Usage(Math.floor(67 + Math.random() * 5));
      setHostRamUsage(Math.floor(43 + Math.random() * 3));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut listener for Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLoadModel = (modelName: string) => {
    setLoadedModelName(modelName);
    setNotification(`Successfully initialized ${modelName} in dual-GPU VRAM.`);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleDeploySuccess = () => {
    setNotification('Model allocated and pinned to GPU 0 & GPU 1. Runtime stream ready.');
    setActiveScreen('chat');
    setTimeout(() => setNotification(null), 3500);
  };

  return (
    <div className={`studio-app flex h-screen w-screen overflow-hidden bg-surface text-on-surface antialiased font-sans ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      {/* Toast Notification */}
      {notification && (
        <div role="status" aria-live="polite" className="fixed top-16 right-6 z-50 bg-[var(--ds-surface-container-low)] border border-blue-500/40 text-blue-300 text-xs px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <span className="material-symbols-outlined text-sm text-[var(--ds-primary)]">info</span>
          <span className="font-mono">{notification}</span>
        </div>
      )}

      {/* Global Sidebar (Fixed w-72) */}
      <Sidebar
        activeScreen={activeScreen}
        onNavigate={(screen) => { setActiveScreen(screen); setMobileNavOpen(false); }}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        gpu0Usage={gpu0Usage}
        gpu1Usage={gpu1Usage}
        hostRamUsage={hostRamUsage}
      />

      {/* Main Workspace Frame */}
      <div className="studio-workspace flex-1 flex flex-col pl-72 h-screen w-full overflow-hidden">
        {/* Fixed Header */}
        <Header
          activeScreen={activeScreen}
          onNavigate={(screen) => { setActiveScreen(screen); setMobileNavOpen(false); }}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        />

        {/* Dynamic Screen Content Container */}
        <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col pt-14 pb-6 overflow-hidden bg-[var(--ds-surface-container-lowest)]">
          {activeScreen === 'chat' && (
            <ChatScreen
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
              onNavigateToPlacement={() => setActiveScreen('load-model')}
            />
          )}

          {activeScreen === 'models' && (
            <ModelsLibraryScreen
              onLoadModel={handleLoadModel}
              onNavigateToChat={() => setActiveScreen('chat')}
              onNavigateToPlacement={() => setActiveScreen('load-model')}
            />
          )}

          {activeScreen === 'model-hubs' && (
            <ModelHubsScreen
              onNavigateToModels={() => setActiveScreen('models')}
              onNavigateToPlacement={() => setActiveScreen('load-model')}
            />
          )}

          {activeScreen === 'hardware' && <HardwareTopologyScreen />}

          {activeScreen === 'load-model' && (
            <LoadModelPlacementScreen
              onDeploySuccess={handleDeploySuccess}
              onBack={() => setActiveScreen('models')}
            />
          )}

          {activeScreen === 'providers-and-runtimes' && <ProvidersRuntimesScreen />}

          {activeScreen === 'local-api' && <LocalApiServerScreen />}

          {activeScreen === 'knowledge' && <KnowledgeRAGScreen />}

          {activeScreen === 'tools-and-permissions' && <ToolsSecurityScreen />}

          {activeScreen === 'downloads' && <DownloadsScreen />}

          {activeScreen === 'logs-and-traces' && <LogsTracesScreen />}

          {activeScreen === 'settings' && <SettingsScreen />}
        </main>

        {/* Global Fixed Statusbar Footer */}
        <Footer
          onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
          onToggleConsole={() => setActiveScreen('logs-and-traces')}
        />
      </div>

      {/* Global Command Palette Modal (Ctrl+K) */}
      <CommandPaletteModal
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(screen) => setActiveScreen(screen)}
        onLoadModel={handleLoadModel}
      />
    </div>
  );
}
