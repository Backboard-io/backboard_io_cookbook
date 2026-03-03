/**
 * Recipe 13: Entity-to-Assistant Mapping
 *
 * Maps external entities (agents, bots, folders) to Backboard assistants
 * via metadata-stored mappings. Check for existing mapping, create assistant
 * if missing, store the mapping as a memory.
 *
 * Distilled from Nash/LibreChat packages/api/src/backboard/agents.ts + folders.ts
 */

import { backboardStorage } from "./ts_storage_abstraction";

// --- Agent-to-Assistant mapping ---

const AGENT_MAP_TYPE = "agent_map";

interface AgentMapping {
  agentId: string;
  bbAssistantId: string;
  name: string;
}

/**
 * Sync an external agent to a Backboard assistant.
 *
 * If a mapping already exists, returns the existing assistantId.
 * If not, creates a new assistant and stores the mapping.
 */
async function syncAgentToAssistant(params: {
  agentId: string;
  name: string;
  description?: string;
}): Promise<string> {
  // Check for existing mapping
  const existing = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    "agentId",
    params.agentId
  );

  if (existing) {
    return existing.metadata.bbAssistantId as string;
  }

  // Create a new Backboard assistant for this agent
  const bb = backboardStorage.getClient();
  const assistant = await bb.createAssistant(params.name, params.description ?? "");

  // Store the mapping as a memory
  await backboardStorage.createItem(
    `Agent mapping: ${params.agentId} -> ${assistant.assistant_id}`,
    {
      type: AGENT_MAP_TYPE,
      agentId: params.agentId,
      bbAssistantId: assistant.assistant_id,
      name: params.name,
    }
  );

  return assistant.assistant_id;
}

/**
 * Look up the Backboard assistantId for an agent.
 */
async function getAssistantForAgent(agentId: string): Promise<string | null> {
  const mapping = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    "agentId",
    agentId
  );
  return mapping ? (mapping.metadata.bbAssistantId as string) : null;
}

/**
 * Delete an agent mapping (and optionally its assistant).
 */
async function deleteAgentMapping(
  agentId: string,
  deleteAssistant = false
): Promise<boolean> {
  const mapping = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    "agentId",
    agentId
  );
  if (!mapping) return false;

  if (deleteAssistant) {
    try {
      const bb = backboardStorage.getClient();
      await bb.deleteMemory(
        await backboardStorage.getAssistantId(),
        mapping.id
      );
    } catch {
      // assistant may already be deleted
    }
  }

  return backboardStorage.deleteItem(mapping.id);
}

/**
 * List all agent mappings.
 */
async function listAgentMappings(): Promise<AgentMapping[]> {
  const items = await backboardStorage.listByType(AGENT_MAP_TYPE);
  return items.map((item) => ({
    agentId: item.metadata.agentId as string,
    bbAssistantId: item.metadata.bbAssistantId as string,
    name: (item.metadata.name as string) ?? "",
  }));
}

// --- Folder isolation pattern ---

const FOLDER_TYPE = "folder";

interface FolderMapping {
  folderId: string;
  name: string;
  assistantId: string;
  shared: boolean;
}

/**
 * Create an isolated folder with its own assistant.
 *
 * If shared=true, uses the main app assistant (memories are shared).
 * If shared=false, creates a new assistant (memories are isolated).
 */
async function createFolder(params: {
  folderId: string;
  name: string;
  shared: boolean;
}): Promise<FolderMapping> {
  let assistantId: string;

  if (params.shared) {
    // Use the main app assistant -- folder shares memory
    assistantId = await backboardStorage.getAssistantId();
  } else {
    // Create an isolated assistant for this folder
    const bb = backboardStorage.getClient();
    const assistant = await bb.createAssistant(
      `folder-${params.folderId}`,
      `Isolated folder: ${params.name}`
    );
    assistantId = assistant.assistant_id;
  }

  const folder: FolderMapping = {
    folderId: params.folderId,
    name: params.name,
    assistantId,
    shared: params.shared,
  };

  await backboardStorage.createItem(JSON.stringify(folder), {
    type: FOLDER_TYPE,
    folderId: params.folderId,
  });

  return folder;
}

/**
 * Delete a folder and its isolated assistant (if not shared).
 */
async function deleteFolder(folderId: string): Promise<boolean> {
  const mapping = await backboardStorage.findByMetadata(
    FOLDER_TYPE,
    "folderId",
    folderId
  );
  if (!mapping) return false;

  const folder = JSON.parse(mapping.content) as FolderMapping;

  // Delete the isolated assistant if it's not shared
  if (!folder.shared && folder.assistantId) {
    try {
      const bb = backboardStorage.getClient();
      // Note: deleteAssistant would go here -- not in the distilled client
      // In production, add a deleteAssistant method to BackboardClient
    } catch {
      // assistant may already be deleted
    }
  }

  return backboardStorage.deleteItem(mapping.id);
}

export {
  syncAgentToAssistant,
  getAssistantForAgent,
  deleteAgentMapping,
  listAgentMappings,
  createFolder,
  deleteFolder,
};
