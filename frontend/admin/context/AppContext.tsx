import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { listAgents, getAgent, listDocs, type AgentSummary, type AgentSettings, type DocItem } from '../lib/api';

// Types for our global state
type AgentWithDetails = {
  agentId: string;
  name: string;
  desc: string;
  settings?: AgentSettings;
  sources?: DocItem[];
  sourcesLastFetched?: number;
};

type AppState = {
  agents: AgentWithDetails[];
  agentsLoading: boolean;
  agentsLastFetched?: number;
  currentAgentId?: string;
};

type AppContextType = {
  state: AppState;
  // Actions
  loadAgents: () => Promise<void>;
  getAgentById: (id: string) => AgentWithDetails | undefined;
  loadAgentDetails: (agentId: string) => Promise<void>;
  loadAgentSources: (agentId: string) => Promise<void>;
  updateAgentSources: (agentId: string, sources: DocItem[]) => void;
  setCurrentAgent: (agentId: string) => void;
  // Helper flags
  isAgentLoading: (agentId: string) => boolean;
  isSourcesLoading: (agentId: string) => boolean;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    agents: [],
    agentsLoading: false,
  });

  const [loadingStates, setLoadingStates] = useState<{
    agents: Set<string>;
    sources: Set<string>;
  }>({
    agents: new Set(),
    sources: new Set(),
  });

  const isAgentLoading = (agentId: string) => loadingStates.agents.has(agentId);
  const isSourcesLoading = (agentId: string) => loadingStates.sources.has(agentId);

  const setAgentLoading = (agentId: string, loading: boolean) => {
    setLoadingStates(prev => ({
      ...prev,
      agents: loading 
        ? new Set([...prev.agents, agentId])
        : new Set([...prev.agents].filter(id => id !== agentId))
    }));
  };

  const setSourcesLoading = (agentId: string, loading: boolean) => {
    setLoadingStates(prev => ({
      ...prev,
      sources: loading 
        ? new Set([...prev.sources, agentId])
        : new Set([...prev.sources].filter(id => id !== agentId))
    }));
  };

  const loadAgents = async () => {
    const now = Date.now();
    
    // Skip if recently fetched
    if (state.agentsLastFetched && (now - state.agentsLastFetched) < CACHE_DURATION) {
      return;
    }

    setState(prev => ({ ...prev, agentsLoading: true }));
    
    try {
      const res = await listAgents();
      const ids = res.items.map(i => i.agentId);
      
      const details = await Promise.all(ids.map(async id => {
        try {
          const settings = await getAgent(id);
          return {
            agentId: id,
            name: settings.agentName || id,
            desc: settings?.notes || '',
            settings
          };
        } catch {
          return {
            agentId: id,
            name: id,
            desc: ''
          };
        }
      }));

      setState(prev => ({
        ...prev,
        agents: details,
        agentsLoading: false,
        agentsLastFetched: now
      }));
    } catch (error) {
      setState(prev => ({ ...prev, agentsLoading: false }));
      throw error;
    }
  };

  const getAgentById = (id: string): AgentWithDetails | undefined => {
    return state.agents.find(agent => agent.agentId === id);
  };

  const loadAgentDetails = async (agentId: string) => {
    const existingAgent = getAgentById(agentId);
    
    // If we already have settings, no need to fetch
    if (existingAgent?.settings) {
      return;
    }

    setAgentLoading(agentId, true);

    try {
      const settings = await getAgent(agentId);
      
      setState(prev => ({
        ...prev,
        agents: prev.agents.map(agent => 
          agent.agentId === agentId 
            ? { 
                ...agent, 
                settings,
                name: settings.agentName || agent.name,
                desc: settings.notes || agent.desc 
              }
            : agent
        )
      }));
    } catch (error) {
      // If agent doesn't exist in our list, add it
      const settings = await getAgent(agentId);
      setState(prev => ({
        ...prev,
        agents: [...prev.agents, {
          agentId,
          name: settings.agentName || agentId,
          desc: settings.notes || '',
          settings
        }]
      }));
    } finally {
      setAgentLoading(agentId, false);
    }
  };

  const loadAgentSources = async (agentId: string) => {
    const agent = getAgentById(agentId);
    const now = Date.now();
    
    // Skip if recently fetched
    if (agent?.sourcesLastFetched && (now - agent.sourcesLastFetched) < CACHE_DURATION) {
      return;
    }

    setSourcesLoading(agentId, true);

    try {
      const res = await listDocs(agentId);
      
      setState(prev => ({
        ...prev,
        agents: prev.agents.map(agent => 
          agent.agentId === agentId 
            ? { 
                ...agent, 
                sources: res.items,
                sourcesLastFetched: now 
              }
            : agent
        )
      }));
    } catch (error) {
      throw error;
    } finally {
      setSourcesLoading(agentId, false);
    }
  };

  const updateAgentSources = (agentId: string, sources: DocItem[]) => {
    setState(prev => ({
      ...prev,
      agents: prev.agents.map(agent => 
        agent.agentId === agentId 
          ? { 
              ...agent, 
              sources,
              sourcesLastFetched: Date.now() 
            }
          : agent
      )
    }));
  };

  const setCurrentAgent = (agentId: string) => {
    setState(prev => ({ ...prev, currentAgentId: agentId }));
  };

  return (
    <AppContext.Provider value={{
      state,
      loadAgents,
      getAgentById,
      loadAgentDetails,
      loadAgentSources,
      updateAgentSources,
      setCurrentAgent,
      isAgentLoading,
      isSourcesLoading,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
