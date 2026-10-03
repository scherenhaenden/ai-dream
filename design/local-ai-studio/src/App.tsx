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
import { AgentScreen } from './components/screens/AgentScreen';

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('chat');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-surface text-on-surface antialiased font-sans">
      <div id="app-background" className="flex min-h-0 min-w-0 flex-1">
      <a href="#main-content" className="fixed left-2 top-2 z-[100] -translate-y-20 rounded bg-primary px-3 py-2 font-medium text-on-primary focus:translate-y-0">Skip to main content</a>
      {/* Global Sidebar (Fixed w-72) */}
      <Sidebar
        activeScreen={activeScreen}
        onNavigate={(screen) => {
          setActiveScreen(screen);
          setSidebarOpen(false);
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Workspace Frame */}
      <div className="flex min-w-0 flex-1 flex-col h-dvh w-full overflow-hidden lg:pl-72">
        {/* Fixed Header */}
        <Header
          activeScreen={activeScreen}
          onNavigate={(screen) => {
            setActiveScreen(screen);
            setSidebarOpen(false);
          }}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
          inspectorOpen={inspectorOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          sidebarOpen={sidebarOpen}
        />

        {/* Dynamic Screen Content Container */}
        <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col pt-14 pb-6 overflow-hidden bg-surface-container-lowest">
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs text-on-surface-variant sm:mx-5">
            <span className="shrink-0 font-semibold text-primary">DESIGN REFERENCE</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0">Sample data/actions only; no connection to Angular or its backend.</span>
          </div>
          {activeScreen === 'chat' && (
            <ChatScreen
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
              onNavigateToPlacement={() => setActiveScreen('load-model')}
            />
          )}

          {activeScreen === 'agent' && <AgentScreen />}

          {activeScreen === 'models' && (
            <ModelsLibraryScreen
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
          inspectorOpen={inspectorOpen}
          onToggleConsole={() => setActiveScreen('logs-and-traces')}
        />
      </div>
      </div>

      {/* Global Command Palette Modal (Ctrl+K) */}
      <CommandPaletteModal
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(screen) => {
          setActiveScreen(screen);
          setSidebarOpen(false);
        }}
      />
    </div>
  );
}
